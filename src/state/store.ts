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

  constructor(config: MonitorConfig) {
    super()
    this.sessions = new Map()
    this.config = config
  }

  /** Process a ParsedEvent and update state */
  applyEvent(event: ParsedEvent): void {
    switch (event.type) {
      case 'session_start': {
        if (!this.sessions.has(event.sessionId)) {
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
            status: 'running',
            startTime: event.timestamp,
            lastActivityTime: event.timestamp,
            tokens: emptyTokenUsage(),
            depth,
          }
          session.agents.set(event.agentId, agent)
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

          // Update token usage from completion event
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
          agent.lastActivityTime = event.timestamp
        }
        session.lastActivityTime = event.timestamp
        break
      }

      case 'tool_use_end': {
        if (event.agentId === null) break
        const session = this.sessions.get(event.sessionId)
        if (!session) break

        const agent = session.agents.get(event.agentId)
        if (agent && agent.currentTool !== null) {
          // Only clear if the toolUseId matches what we'd expect (best effort)
          agent.currentTool = null
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
      for (const agent of session.agents.values()) {
        if (agent.status !== 'running' && agent.status !== 'idle') continue
        const idleThreshold = agent.lastActivityTime.getTime() + this.config.maxIdleTime
        if (now > idleThreshold) {
          if (agent.status !== 'idle') {
            agent.status = 'idle'
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
