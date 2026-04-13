import React from 'react'
import { Box, Text } from 'ink'
import type { Session } from '../types.ts'

interface HeaderProps {
  sessions: Session[]
  hooksActive: boolean
  lastUpdateMs: number
}

export function Header({ sessions, hooksActive, lastUpdateMs }: HeaderProps) {
  const agentCount = sessions.reduce((sum, s) => sum + s.agents.size, 0)
  const activeSessions = sessions.filter(s => s.status === 'active').length

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text bold color="green">claude-mon</Text>
      <Text dimColor>
        {activeSessions} session{activeSessions !== 1 ? 's' : ''} | {agentCount} agent{agentCount !== 1 ? 's' : ''} | refresh: {lastUpdateMs}ms | hooks: {hooksActive ? <Text color="green">active</Text> : <Text color="gray">inactive</Text>}
      </Text>
    </Box>
  )
}
