interface ModelPricing {
  prefix: string
  inputPer1M: number   // USD per 1M input tokens
  outputPer1M: number  // USD per 1M output tokens
}

const MODEL_PRICING_PREFIXES: ModelPricing[] = [
  { prefix: 'claude-opus-4',    inputPer1M: 15.00, outputPer1M: 75.00 },
  { prefix: 'claude-sonnet-4',  inputPer1M: 3.00,  outputPer1M: 15.00 },
  { prefix: 'claude-haiku-4-5', inputPer1M: 0.80,  outputPer1M: 4.00  },
  { prefix: 'claude-haiku-3-5', inputPer1M: 0.80,  outputPer1M: 4.00  },
]

// Short aliases passed via Agent tool's model parameter (e.g. model: "sonnet")
const MODEL_ALIASES: Record<string, string> = {
  'opus':   'claude-opus-4',
  'sonnet': 'claude-sonnet-4',
  'haiku':  'claude-haiku-4-5',
}

/**
 * Get pricing for a model. Returns null for unknown/non-Anthropic models.
 * Handles both full model IDs and short aliases (e.g. "sonnet", "opus").
 */
export function getModelPricing(model: string): ModelPricing | null {
  const resolved = MODEL_ALIASES[model] ?? model
  for (const pricing of MODEL_PRICING_PREFIXES) {
    if (resolved.startsWith(pricing.prefix)) {
      return pricing
    }
  }
  return null
}

/**
 * Calculate estimated cost in USD. Returns null for non-Anthropic models.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = getModelPricing(model)
  if (pricing === null) return null
  return (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M
}

/**
 * Shorten model name for display: "claude-haiku-4-5-20251001" → "haiku-4.5"
 * "claude-sonnet-4-6" → "sonnet-4.6"
 * Non-Anthropic: return as-is
 */
export function shortenModelName(model: string): string {
  if (!model.startsWith('claude-')) return model

  // Strip "claude-" prefix
  let rest = model.slice('claude-'.length)

  // Strip trailing date suffix like "-20251001"
  rest = rest.replace(/-\d{8}$/, '')

  // Convert last hyphen-separated version number to dot notation
  // e.g. "haiku-4-5" → "haiku-4.5", "sonnet-4-6" → "sonnet-4.6"
  rest = rest.replace(/-(\d+)$/, '.$1')

  return rest
}
