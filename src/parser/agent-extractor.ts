import type { ParsedEvent, TokenUpdateEvent, ToolUseStartEvent, ToolUseEndEvent } from '../types.ts'
import type { ParseResult } from './jsonl-parser.ts'
import { readJsonlLines } from './jsonl-parser.ts'

// Persisted across incremental reads (fromOffset > 0) so tool_use end-events
// for nested Agent spawns can be suppressed even when the tool_result arrives
// in a later read batch. Keyed by filePath to handle multiple subagents.
const agentSpawnIdsByFile = new Map<string, Set<string>>()

/**
 * Parse a subagent's JSONL file for model, token, and tool activity.
 * The subagent's model comes from message.model on assistant lines within this file.
 */
export async function parseSubagentJsonl(
  filePath: string,
  agentId: string,
  sessionId: string,
  fromOffset: number,
): Promise<ParseResult> {
  const agentSpawnIds = agentSpawnIdsByFile.get(filePath) ?? new Set<string>()
  agentSpawnIdsByFile.set(filePath, agentSpawnIds)

  return readJsonlLines(filePath, fromOffset, (line) => {
    return parseSubagentLine(line, agentId, sessionId, agentSpawnIds)
  })
}

function parseSubagentLine(
  raw: string,
  agentId: string,
  sessionId: string,
  agentSpawnIds: Set<string>,
): ParsedEvent[] {
  try {
    const line = JSON.parse(raw) as Record<string, unknown>
    const timestamp = new Date(
      typeof line.timestamp === 'string' ? line.timestamp : Date.now()
    )

    if (line.type === 'assistant') {
      const message = line.message as Record<string, unknown> | undefined
      if (!message) return []

      const results: ParsedEvent[] = []

      // Token update
      const model = (message.model as string | undefined) ?? ''
      const usage = message.usage as {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      } | undefined

      if (usage) {
        const tokenEvent: TokenUpdateEvent = {
          type: 'token_update',
          sessionId,
          timestamp,
          source: 'jsonl',
          agentId,
          model,
          usage: {
            input_tokens: usage.input_tokens ?? 0,
            output_tokens: usage.output_tokens ?? 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
          },
        }
        results.push(tokenEvent)
      }

      // Tool use events
      const content = message.content as unknown[] | undefined
      if (Array.isArray(content)) {
        for (const item of content) {
          const block = item as Record<string, unknown>
          if (block.type !== 'tool_use') continue

          const toolUseId = block.id as string | undefined
          if (!toolUseId) continue

          if (block.name === 'Agent') {
            agentSpawnIds.add(toolUseId)
            continue
          }

          const toolEvent: ToolUseStartEvent = {
            type: 'tool_use_start',
            sessionId,
            timestamp,
            source: 'jsonl',
            agentId,
            toolName: (block.name as string | undefined) ?? '',
            toolUseId,
            toolInput: typeof block.input === 'object' && block.input !== null
              ? block.input as Record<string, unknown>
              : null,
          }
          results.push(toolEvent)
        }
      }

      return results
    }

    if (line.type === 'user') {
      const content = (line.message as Record<string, unknown> | undefined)
        ?.content as unknown[] | undefined
      if (!Array.isArray(content)) return []

      const results: ParsedEvent[] = []
      for (const item of content) {
        const block = item as Record<string, unknown>
        if (block.type !== 'tool_result') continue

        const toolUseId = block.tool_use_id as string | undefined
        if (!toolUseId || agentSpawnIds.has(toolUseId)) continue

        const endEvent: ToolUseEndEvent = {
          type: 'tool_use_end',
          sessionId,
          timestamp,
          source: 'jsonl',
          agentId,
          toolName: '',
          toolUseId,
        }
        results.push(endEvent)
      }
      return results
    }

    return []
  } catch {
    return []
  }
}
