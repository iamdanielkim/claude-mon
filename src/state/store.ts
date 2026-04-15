import { EventEmitter } from 'events'
import type {
  Session,
  Agent,
  ParsedEvent,
  MonitorConfig,
  TokenUsage,
  AgentStatus,
} from '../types.ts'
import { calculateCost } from '../parser/pricing.ts'

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    estimatedCost: null,
  }
}

export class StateStore extends EventEmitter {
  private sessions: Map<string, Session>
  private config: MonitorConfig
  // sessionId → FIFO queue of tool_use_ids for unmatched Agent spawns
  private pendingAgentSpawns = new Map<string, string[]>()

  constructor(config: MonitorConfig) {
    super()
    this.sessions = new Map()
    this.config = config
  }

  /** Process a ParsedEvent and update state */
  applyEvent(event: ParsedEvent): void {
    switch (event.type) {
      case 'session_start': {
        const existing = this.sessions.get(event.sessionId)
        if (!existing) {
          const session: Session = {
            id: event.sessionId,
            projectHash: '',
            projectPath: event.projectPath,
            name: null,
            jsonlPath: event.jsonlPath,
            status: 'active',
            startTime: event.timestamp,
            lastActivityTime: event.timestamp,
            agents: new Map(),
            version: event.version,
          }
          this.sessions.set(event.sessionId, session)
        } else if (!existing.projectPath) {
          // Race condition: session was pre-created by getOrCreateSession before
          // session_start was processed — backfill the missing projectPath
          existing.projectPath = event.projectPath
          existing.jsonlPath = event.jsonlPath
          existing.version = event.version
        }
        break
      }

      case 'session_name': {
        const session = this.sessions.get(event.sessionId)
        if (session) {
          session.name = event.name
          session.lastActivityTime = event.timestamp
        }
        break
      }

      case 'agent_spawned': {
        const session = this.getOrCreateSession(event.sessionId, event.timestamp)
        if (!session.agents.has(event.agentId)) {
          const parentAgent = event.parentAgentId
            ? session.agents.get(event.parentAgentId)
            : null
          const depth = parentAgent ? parentAgent.depth + 1 : 0

          const agent: Agent = {
            id: event.agentId,
            sessionId: event.sessionId,
            parentAgentId: event.parentAgentId,
            model: event.model ?? '',
            agentType: event.agentType,
            description: event.description,
            currentTool: null,
            currentToolInput: null,
            currentToolUseId: null,
            status: 'running',
            startTime: event.timestamp,
            lastActivityTime: event.timestamp,
            tokens: emptyTokenUsage(),
            depth,
          }
          session.agents.set(event.agentId, agent)
          // Track for hexId → tool_use_id correlation (Fix 2)
          const q = this.pendingAgentSpawns.get(event.sessionId) ?? []
          q.push(event.agentId)
          this.pendingAgentSpawns.set(event.sessionId, q)
        }
        session.lastActivityTime = event.timestamp
        break
      }

      case 'agent_completed': {
        const session = this.sessions.get(event.sessionId)
        if (!session) break

        const agent = session.agents.get(event.agentId)
        if (agent) {
          const status: AgentStatus = event.status === 'completed' ? 'completed' : 'error'
          agent.status = status
          agent.lastActivityTime = event.timestamp
          agent.currentTool = null
          agent.currentToolInput = null
          agent.currentToolUseId = null

          // Only overwrite streaming-accumulated tokens when real data is provided.
          // Synthetic completion events (from tool_result detection) carry totalTokens:0
          // to avoid wiping tokens streamed from the subagent JSONL.
          if (event.totalTokens > 0) {
            const usage = event.usage
            agent.tokens.inputTokens = usage.input_tokens
            agent.tokens.outputTokens = usage.output_tokens
            agent.tokens.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
            agent.tokens.cacheReadTokens = usage.cache_read_input_tokens ?? 0
            agent.tokens.totalTokens = event.totalTokens
            agent.tokens.estimatedCost = agent.model
              ? calculateCost(agent.model, usage.input_tokens, usage.output_tokens)
              : null
          }
        }
        session.lastActivityTime = event.timestamp
        break
      }

      case 'tool_use_start': {
        if (event.agentId === null) break
        const session = this.sessions.get(event.sessionId)
        if (!session) break

        const agent = session.agents.get(event.agentId)
        if (agent) {
          agent.currentTool = event.toolName
          agent.currentToolInput = event.toolInput
          agent.currentToolUseId = event.toolUseId
          agent.lastActivityTime = event.timestamp
          // Resume from idle — a new tool call means the agent is active again
          if (agent.status === 'idle') agent.status = 'running'
        }
        session.lastActivityTime = event.timestamp
        break
      }

      case 'tool_use_end': {
        if (event.agentId === null) break
        const session = this.sessions.get(event.sessionId)
        if (!session) break

        const agent = session.agents.get(event.agentId)
        if (agent && agent.currentToolUseId === event.toolUseId) {
          agent.currentTool = null
          agent.currentToolInput = null
          agent.currentToolUseId = null
          agent.lastActivityTime = event.timestamp
        }
        session.lastActivityTime = event.timestamp
        break
      }

      case 'token_update': {
        const session = this.getOrCreateSession(event.sessionId, event.timestamp)
        session.lastActivityTime = event.timestamp

        const usage = event.usage
        const inputTokens = usage.input_tokens
        const outputTokens = usage.output_tokens
        const cacheCreation = usage.cache_creation_input_tokens ?? 0
        const cacheRead = usage.cache_read_input_tokens ?? 0

        if (event.agentId !== null) {
          const agent = session.agents.get(event.agentId)
          if (agent) {
            agent.tokens.inputTokens += inputTokens
            agent.tokens.outputTokens += outputTokens
            agent.tokens.cacheCreationTokens += cacheCreation
            agent.tokens.cacheReadTokens += cacheRead
            agent.tokens.totalTokens += inputTokens + outputTokens + cacheCreation + cacheRead
            agent.lastActivityTime = event.timestamp

            // Update model if we have one and agent's model is empty
            if (event.model && !agent.model) {
              agent.model = event.model
            }

            const modelForCost = agent.model || event.model
            agent.tokens.estimatedCost = calculateCost(
              modelForCost,
              agent.tokens.inputTokens,
              agent.tokens.outputTokens,
            )
          }
        }
        break
      }
    }

    this.emit('state-changed')
  }

  /** Remove a session and its agents from state */
  removeSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      this.pendingAgentSpawns.delete(sessionId)
      this.emit('state-changed')
    }
  }

  /**
   * Match a subagent hex ID to a tracked tool_use_id.
   * Step 1: content match on agentType + description (both non-empty, exact equality).
   * Step 2: FIFO fallback.
   * Returns undefined if no match (caller should defer).
   */
  matchSubagent(sessionId: string, agentType?: string, description?: string): string | undefined {
    const session = this.sessions.get(sessionId)
    const q = this.pendingAgentSpawns.get(sessionId)
    if (!session || !q?.length) return undefined

    // Step 1: content match
    if (agentType && description) {
      const idx = q.findIndex(id => {
        const a = session.agents.get(id)
        return a?.agentType === agentType && a?.description === description
      })
      if (idx !== -1) return q.splice(idx, 1)[0]
    }

    // Step 2: FIFO fallback
    return q.shift()
  }

  /** Get a snapshot of all sessions sorted by last activity (most recent first) */
  getState(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastActivityTime.getTime() - a.lastActivityTime.getTime(),
    )
  }

  /** Check for and mark idle agents (no activity for maxIdleTime) */
  tickIdleCheck(): void {
    const now = Date.now()
    let changed = false

    for (const session of this.sessions.values()) {
      const agents = [...session.agents.values()]

      for (const agent of agents) {
        if (agent.status !== 'running' && agent.status !== 'idle') continue

        // Agent has an in-flight tool call — not idle regardless of elapsed time
        if (agent.currentToolUseId !== null) continue

        // Agent is waiting for a child subagent — not idle
        const hasActiveChild = agents.some(
          a => a.parentAgentId === agent.id &&
               (a.status === 'running' || a.status === 'idle')
        )
        if (hasActiveChild) continue

        const idleThreshold = agent.lastActivityTime.getTime() + this.config.maxIdleTime
        if (now > idleThreshold) {
          if (agent.status !== 'idle') {
            agent.status = 'idle'
            agent.currentTool = null
            agent.currentToolInput = null
            agent.currentToolUseId = null
            changed = true
          }
        }
      }
    }

    if (changed) {
      this.emit('state-changed')
    }
  }

  private getOrCreateSession(sessionId: string, timestamp: Date): Session {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        projectHash: '',
        projectPath: '',
        name: null,
        jsonlPath: '',
        status: 'active',
        startTime: timestamp,
        lastActivityTime: timestamp,
        agents: new Map(),
        version: '',
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }
}
