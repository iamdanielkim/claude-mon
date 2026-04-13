import React from 'react'
import { Box, Text } from 'ink'
import type { Session, Agent } from '../types.ts'
import { AgentRow } from './AgentRow.tsx'
import { theme, COLUMN_WIDTHS } from './theme.ts'

interface SessionTreeProps {
  sessions: Session[]
  showCompleted: boolean
}

function formatStartTime(date: Date): string {
  const yy = date.getFullYear().toString().slice(2)
  const mo = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `(${mo}/${dd}/${yy} ${h}:${m}:${s})`
}

function getAgentTree(session: Session): Agent[] {
  // Get root agents (no parent or parent not in this session)
  const allAgents = Array.from(session.agents.values())
  const agentIds = new Set(allAgents.map(a => a.id))
  const roots = allAgents.filter(a => !a.parentAgentId || !agentIds.has(a.parentAgentId))

  // DFS order
  const result: Agent[] = []
  function visit(agent: Agent) {
    result.push(agent)
    const children = allAgents
      .filter(a => a.parentAgentId === agent.id)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    children.forEach(visit)
  }
  roots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()).forEach(visit)
  return result
}

export function SessionTree({ sessions, showCompleted }: SessionTreeProps) {
  const visibleSessions = sessions.filter(s =>
    showCompleted || s.status !== 'completed'
  )

  if (visibleSessions.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No active Claude Code sessions found.</Text>
        <Text dimColor> (Watching ~/.claude/projects/ for new sessions...)</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {visibleSessions.map((session, si) => {
        const agents = getAgentTree(session).filter(a =>
          showCompleted || a.status !== 'completed'
        )
        const displayName = session.name || session.projectPath || session.id.slice(0, 12)

        return (
          <Box key={session.id} flexDirection="column" marginTop={si > 0 ? 1 : 0}>
            {/* Session header */}
            <Box>
              <Text bold color="white">└ </Text>
              <Text bold color="white">{displayName}</Text>
              <Text dimColor> {formatStartTime(session.startTime)}</Text>
              <Text dimColor>  [{session.status}]</Text>
            </Box>
            {/* Column header per session — indent matches icon(2) + prefix(2) + treeChar(4) = 8 chars */}
            <Box>
              <Text>{'        '}</Text>
              <Text color={theme.colors.columnHeader} bold>{'AGENT'.padEnd(COLUMN_WIDTHS.name)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'MODEL'.padEnd(COLUMN_WIDTHS.model)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'TOOL'.padEnd(COLUMN_WIDTHS.tool)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'CREATED'.padStart(COLUMN_WIDTHS.created)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'ELAPSED'.padStart(COLUMN_WIDTHS.elapsed)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'TOKENS'.padStart(COLUMN_WIDTHS.tokens)}</Text>
              <Text color={theme.colors.columnHeader} bold>{' ' + 'COST'.padStart(COLUMN_WIDTHS.cost)}</Text>
            </Box>
            {/* Agents */}
            {agents.map((agent, ai) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isLast={ai === agents.length - 1}
                prefix="  "
              />
            ))}
            {agents.length === 0 && (
              <Box paddingLeft={4}>
                <Text dimColor>No agents running</Text>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
