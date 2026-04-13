import React from 'react'
import { Box, Text } from 'ink'

interface StatusBarProps {
  hooksActive: boolean
  showCompleted: boolean
}

export function StatusBar({ hooksActive, showCompleted }: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text dimColor>[q] quit  [c] toggle completed  [h] hooks status</Text>
      <Text dimColor>
        Data: JSONL{hooksActive ? ' + Hooks' : ''} | completed: {showCompleted ? 'shown' : 'hidden'}
      </Text>
    </Box>
  )
}
