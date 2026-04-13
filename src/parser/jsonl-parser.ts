import type { ParsedEvent, SessionStartEvent, SessionNameEvent, AgentSpawnedEvent, AgentCompletedEvent, ToolUseEndEvent, TokenUpdateEvent } from '../types.ts'
import { createReadStream } from 'fs'

export interface ParseResult {
  events: ParsedEvent[]
  newOffset: number  // byte offset after last successfully parsed line
}

/**
 * Shared streaming helper: reads new lines from a JSONL file since the last offset,
 * calls parseLine for each complete line, returns all emitted events and the new offset.
 */
export async function readJsonlLines<T>(
  filePath: string,
  fromOffset: number,
  parseLine: (line: string) => T[],
): Promise<{ events: T[], newOffset: number }> {
  const events: T[] = []
  let newOffset = fromOffset

  return new Promise((resolve) => {
    let stream: ReturnType<typeof createReadStream>
    try {
      stream = createReadStream(filePath, { start: fromOffset, encoding: 'utf-8' })
    } catch {
      resolve({ events, newOffset })
      return
    }

    let buffer = ''

    stream.on('data', (chunk: string) => {
      buffer += chunk
    })

    stream.on('end', () => {
      const lines = buffer.split('\n')
      // The last element may be an incomplete line — keep it pending
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]
        newOffset += Buffer.byteLength(line + '\n', 'utf-8')
        if (line.trim() === '') continue
        events.push(...parseLine(line))
      }
      resolve({ events, newOffset })
    })

    stream.on('error', () => {
      resolve({ events, newOffset })
    })
  })
}

/**
 * Parse new lines appended to a JSONL file since the last read offset.
 * Returns parsed events and the new byte offset.
 */
export async function parseJsonlIncremental(
  filePath: string,
  fromOffset: number,
  sessionId: string,
): Promise<ParseResult> {
  return readJsonlLines(filePath, fromOffset, (line) => parseJsonlLine(line, sessionId, filePath))
}

export const MAIN_AGENT_ID = 'main'

// Track which sessions we've already emitted a session_start for (per file path)
const seenCwdByFile = new Map<string, boolean>()

/**
 * Parse a single raw JSONL line into zero or more ParsedEvents.
 * A single JSONL line can produce multiple events (e.g., TokenUpdateEvent + AgentSpawnedEvent).
 * Returns empty array for unknown/irrelevant line types.
 * Never throws — catches parse errors and returns [].
 */
export function parseJsonlLine(
  raw: string,
  sessionId: string,
  filePath: string,
): ParsedEvent[] {
  try {
    const line = JSON.parse(raw) as Record<string, unknown>
    const type = line.type as string | undefined
    const timestamp = new Date(
      typeof line.timestamp === 'string' ? line.timestamp : Date.now()
    )

    if (type === 'assistant') {
      const message = line.message as Record<string, unknown> | undefined
      if (!message) return []

      const model = (message.model as string | undefined) ?? ''
      const usage = message.usage as {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      } | undefined

      const resultEvents: ParsedEvent[] = []

      // Emit TokenUpdateEvent attributed to the main agent
      if (usage) {
        const tokenEvent: TokenUpdateEvent = {
          type: 'token_update',
          sessionId,
          timestamp,
          source: 'jsonl',
          agentId: MAIN_AGENT_ID,
          model,
          usage: {
            input_tokens: usage.input_tokens ?? 0,
            output_tokens: usage.output_tokens ?? 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
          },
        }
        resultEvents.push(tokenEvent)
      }

      // Scan content for tool_use entries
      const content = message.content as unknown[] | undefined
      if (Array.isArray(content)) {
        for (const item of content) {
          const block = item as Record<string, unknown>
          if (block.type !== 'tool_use') continue

          if (block.name === 'Agent') {
            // Subagent spawn
            const input = block.input as Record<string, unknown> | undefined
            if (!input) continue
            const agentId = block.id as string | undefined
            if (!agentId) continue

            const spawnedEvent: AgentSpawnedEvent = {
              type: 'agent_spawned',
              sessionId,
              timestamp,
              source: 'jsonl',
              agentId,
              parentAgentId: null,
              agentType: (input.subagent_type as string | undefined) ?? 'unknown',
              description: (input.description as string | undefined) ?? '',
              model: (input.model as string | undefined) ?? null,
            }
            resultEvents.push(spawnedEvent)
          } else {
            // Main agent tool call
            const toolUseId = block.id as string | undefined
            if (!toolUseId) continue
            resultEvents.push({
              type: 'tool_use_start',
              sessionId,
              timestamp,
              source: 'jsonl',
              agentId: MAIN_AGENT_ID,
              toolName: (block.name as string | undefined) ?? '',
              toolUseId,
            })
          }
        }
      }

      return resultEvents
    }

    if (type === 'user') {
      const resultEvents: ParsedEvent[] = []

      // Check for cwd → SessionStartEvent
      const cwd = line.cwd as string | undefined
      const fileKey = filePath + ':' + sessionId
      if (cwd && !seenCwdByFile.get(fileKey)) {
        seenCwdByFile.set(fileKey, true)
        const version = (line.version as string | undefined) ?? ''
        const startEvent: SessionStartEvent = {
          type: 'session_start',
          sessionId,
          timestamp,
          source: 'jsonl',
          projectPath: cwd,
          version,
          jsonlPath: filePath,
        }
        resultEvents.push(startEvent)

        // Spawn a synthetic main agent to represent the top-level session
        const mainAgentEvent: AgentSpawnedEvent = {
          type: 'agent_spawned',
          sessionId,
          timestamp,
          source: 'jsonl',
          agentId: MAIN_AGENT_ID,
          parentAgentId: null,
          agentType: 'claude-code',
          description: '',
          model: null,
        }
        resultEvents.push(mainAgentEvent)
      }

      // Check for agent completion: toolUseResult with agentId
      const toolUseResult = line.toolUseResult as Record<string, unknown> | undefined
      if (toolUseResult && typeof toolUseResult.agentId === 'string') {
        const completedEvent: AgentCompletedEvent = {
          type: 'agent_completed',
          sessionId,
          timestamp,
          source: 'jsonl',
          agentId: toolUseResult.agentId as string,
          agentType: (toolUseResult.agentType as string | undefined) ?? 'unknown',
          totalTokens: (toolUseResult.totalTokens as number | undefined) ?? 0,
          totalDurationMs: (toolUseResult.totalDurationMs as number | undefined) ?? 0,
          totalToolUseCount: (toolUseResult.totalToolUseCount as number | undefined) ?? 0,
          usage: (toolUseResult.usage as AgentCompletedEvent['usage'] | undefined) ?? {
            input_tokens: 0,
            output_tokens: 0,
          },
          status: (toolUseResult.status as string | undefined) ?? 'completed',
        }
        resultEvents.push(completedEvent)
      }

      // Check content for tool_result entries → ToolUseEndEvent
      const content = line.content as unknown[] | undefined
      if (Array.isArray(content)) {
        for (const item of content) {
          const block = item as Record<string, unknown>
          if (block.type === 'tool_result') {
            const toolUseId = block.tool_use_id as string | undefined
            if (toolUseId) {
              const endEvent: ToolUseEndEvent = {
                type: 'tool_use_end',
                sessionId,
                timestamp,
                source: 'jsonl',
                agentId: MAIN_AGENT_ID,
                toolName: '',  // tool name not available in tool_result blocks
                toolUseId,
              }
              resultEvents.push(endEvent)
            }
          }
        }
      }

      return resultEvents
    }

    if (type === 'agent-name') {
      const agentName = line.agentName as string | undefined
      if (!agentName) return []
      const nameEvent: SessionNameEvent = {
        type: 'session_name',
        sessionId,
        timestamp,
        source: 'jsonl',
        name: agentName,
      }
      return [nameEvent]
    }

    // queue-operation and all other types: no events emitted
    return []
  } catch {
    return []
  }
}
