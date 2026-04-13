import type { TokenUpdateEvent } from '../types.ts'
import type { ParseResult } from './jsonl-parser.ts'
import { readJsonlLines } from './jsonl-parser.ts'

/**
 * Parse a subagent's JSONL file for model and tool activity.
 * The subagent's model comes from message.model on assistant lines within this file.
 */
export async function parseSubagentJsonl(
  filePath: string,
  agentId: string,
  sessionId: string,
  fromOffset: number,
): Promise<ParseResult> {
  return readJsonlLines(filePath, fromOffset, (line) => {
    const event = parseSubagentLine(line, agentId, sessionId)
    return event !== null ? [event] : []
  })
}

function parseSubagentLine(
  raw: string,
  agentId: string,
  sessionId: string,
): TokenUpdateEvent | null {
  try {
    const line = JSON.parse(raw) as Record<string, unknown>
    if (line.type !== 'assistant') return null

    const message = line.message as Record<string, unknown> | undefined
    if (!message) return null

    const model = (message.model as string | undefined) ?? ''
    const usage = message.usage as {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    } | undefined

    if (!usage) return null

    const timestamp = new Date(
      typeof line.timestamp === 'string' ? line.timestamp : Date.now()
    )

    return {
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
  } catch {
    return null
  }
}
