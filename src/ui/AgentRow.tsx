import React from 'react'
import { Box, Text } from 'ink'
import type { Agent } from '../types.ts'
import { shortenModelName } from '../parser/pricing.ts'
import { theme, COLUMN_WIDTHS } from './theme.ts'

interface AgentRowProps {
  agent: Agent
  isLast: boolean
  prefix: string  // tree prefix from parent (e.g., "  │  ")
}

function formatElapsed(startTime: Date, lastActivityTime: Date, status: Agent['status']): string {
  const end = status === 'running' ? new Date() : lastActivityTime
  const ms = end.getTime() - startTime.getTime()
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m}m${s % 60}s`
  return `${s}s`
}

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1000) return `${(total / 1000).toFixed(1)}K`
  return String(total)
}

function formatCost(cost: number | null): string {
  if (cost === null) return 'N/A'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s.padEnd(len)
  return s.slice(0, len - 1) + '…'
}

export function AgentRow({ agent, isLast, prefix }: AgentRowProps) {
  const isDim = agent.status === 'completed' || agent.status === 'idle'
  const icon = theme.icons[agent.status] ?? '?'
  const iconColor = theme.colors[agent.status] ?? 'white'

  const treeChar = isLast ? '└── ' : '├── '
  const nameWidth = Math.max(8, COLUMN_WIDTHS.name - prefix.length - treeChar.length)
  const shortId = agent.id.slice(-6)
  const agentLabel = agent.agentType
    ? `${agent.agentType.split(':').pop() ?? agent.agentType}:${shortId}`
    : shortId

  const modelShort = agent.model ? shortenModelName(agent.model) : '...'
  const tool = agent.currentTool ?? '—'
  const createdTime = agent.startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const elapsed = formatElapsed(agent.startTime, agent.lastActivityTime, agent.status)
  const tokens = formatTokens(agent.tokens.totalTokens)
  const cost = formatCost(agent.tokens.estimatedCost)

  return (
    <Box>
      <Text color={iconColor} dimColor={isDim}>{icon} </Text>
      <Text color={theme.colors.treeLines} dimColor>{prefix}{treeChar}</Text>
      <Text dimColor={isDim}>{truncate(agentLabel, nameWidth)}</Text>
      <Text color={theme.colors.modelName} dimColor={isDim}> {truncate(modelShort, COLUMN_WIDTHS.model)}</Text>
      <Text dimColor={isDim}> {truncate(tool, COLUMN_WIDTHS.tool)}</Text>
      <Text color={theme.colors[agent.status]} dimColor={isDim}> {agent.status.padEnd(COLUMN_WIDTHS.status)}</Text>
      <Text dimColor={isDim}> {createdTime.padStart(COLUMN_WIDTHS.created)}</Text>
      <Text dimColor={isDim}> {elapsed.padStart(COLUMN_WIDTHS.elapsed)}</Text>
      <Text dimColor={isDim}> {tokens.padStart(COLUMN_WIDTHS.tokens)}</Text>
      <Text color={theme.colors.cost} dimColor={isDim}> {cost.padStart(COLUMN_WIDTHS.cost)}</Text>
    </Box>
  )
}
