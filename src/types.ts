export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  estimatedCost: number | null  // null = non-Anthropic model, display as "N/A"
}

export type AgentStatus = 'running' | 'idle' | 'completed' | 'error'
export type SessionStatus = 'active' | 'idle' | 'completed'

export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  model: string           // populated lazily from subagent JSONL; may be from input.model as early hint
  agentType: string       // e.g., "oh-my-claudecode:planner", "Explore"
  description: string
  currentTool: string | null
  currentToolInput: Record<string, unknown> | null
  currentToolUseId: string | null
  status: AgentStatus
  startTime: Date
  lastActivityTime: Date
  tokens: TokenUsage
  depth: number
}

export interface Session {
  id: string
  projectHash: string
  projectPath: string     // resolved from cwd in JSONL
  name: string | null     // from agent-name type line
  jsonlPath: string
  status: SessionStatus
  startTime: Date
  lastActivityTime: Date
  agents: Map<string, Agent>
  version: string
}

export interface HookEvent {
  source: 'hook'
  sessionId: string
  agentId?: string
  eventType: 'PreToolUse' | 'PostToolUse'
  toolName: string
  timestamp: Date
  payload: Record<string, unknown>
}

export interface MonitorConfig {
  claudeDir: string       // ~/.claude
  monDir: string          // ~/.claude/mon
  refreshInterval: number // ms, default 1000
  useHooks: boolean       // auto-detected
  showCompleted: boolean  // default true
  maxIdleTime: number     // ms before marking idle, default 30000
}

// ParsedEvent union — state store and UI consume only ParsedEvent, never raw JSONL
export interface BaseEvent {
  type: 'session_start' | 'session_name' | 'agent_spawned' | 'agent_completed' | 'tool_use_start' | 'tool_use_end' | 'token_update'
  sessionId: string
  timestamp: Date
  source: 'jsonl' | 'hook'
}

export interface SessionStartEvent extends BaseEvent {
  type: 'session_start'
  projectPath: string
  version: string
  jsonlPath: string
}

export interface SessionNameEvent extends BaseEvent {
  type: 'session_name'
  name: string
}

export interface AgentSpawnedEvent extends BaseEvent {
  type: 'agent_spawned'
  agentId: string
  parentAgentId: string | null
  agentType: string
  description: string
  model: string | null    // from input.model if present (early hint, ~20% of cases)
}

export interface AgentCompletedEvent extends BaseEvent {
  type: 'agent_completed'
  agentId: string
  agentType: string
  totalTokens: number
  totalDurationMs: number
  totalToolUseCount: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  status: string
}

export interface ToolUseStartEvent extends BaseEvent {
  type: 'tool_use_start'
  agentId: string | null
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown> | null
}

export interface ToolUseEndEvent extends BaseEvent {
  type: 'tool_use_end'
  agentId: string | null
  toolName: string
  toolUseId: string
}

export interface TokenUpdateEvent extends BaseEvent {
  type: 'token_update'
  agentId: string | null
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export type ParsedEvent =
  | SessionStartEvent
  | SessionNameEvent
  | AgentSpawnedEvent
  | AgentCompletedEvent
  | ToolUseStartEvent
  | ToolUseEndEvent
  | TokenUpdateEvent
