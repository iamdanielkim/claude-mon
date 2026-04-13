import React, { useState, useEffect, useCallback } from 'react'
import { Box, useApp, useInput } from 'ink'
import type { Session, MonitorConfig } from '../types.ts'
import { Header } from './Header.tsx'
import { SessionTree } from './SessionTree.tsx'
import { StatusBar } from './StatusBar.tsx'
import { StateStore } from '../state/store.ts'
import { FileWatcher } from '../watcher/file-watcher.ts'
import { parseJsonlIncremental } from '../parser/jsonl-parser.ts'
import { parseSubagentJsonl } from '../parser/agent-extractor.ts'

interface AppProps {
  config: MonitorConfig
}

export function App({ config }: AppProps) {
  const { exit } = useApp()
  const [sessions, setSessions] = useState<Session[]>([])
  const [hooksActive, setHooksActive] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)
  const [lastUpdateMs, setLastUpdateMs] = useState(0)

  useInput((input) => {
    if (input === 'q') exit()
    if (input === 'c') setShowCompleted(v => !v)
    if (input === 'h') setHooksActive(v => !v)  // just toggle display for now
  })

  useEffect(() => {
    const store = new StateStore(config)
    const watcher = new FileWatcher(config)

    // Track file offsets for incremental parsing
    const offsets = new Map<string, number>()

    async function processFile(sessionId: string, filePath: string) {
      const offset = offsets.get(filePath) ?? 0
      const { events, newOffset } = await parseJsonlIncremental(filePath, offset, sessionId)
      offsets.set(filePath, newOffset)
      const t0 = Date.now()
      events.forEach(e => store.applyEvent(e))
      setLastUpdateMs(Date.now() - t0)
    }

    async function processSubagent(sessionId: string, agentId: string, filePath: string) {
      const offset = offsets.get(filePath) ?? 0
      const { events, newOffset } = await parseSubagentJsonl(filePath, agentId, sessionId, offset)
      offsets.set(filePath, newOffset)
      events.forEach(e => store.applyEvent(e))
    }

    store.on('state-changed', () => {
      setSessions(store.getState())
    })

    watcher.on('session-discovered', async (discovered) => {
      await processFile(discovered.sessionId, discovered.jsonlPath)
      for (const sub of discovered.subagentFiles) {
        await processSubagent(discovered.sessionId, sub.agentId, sub.jsonlPath)
      }
    })

    watcher.on('session-updated', async (sessionId, jsonlPath) => {
      await processFile(sessionId, jsonlPath)
    })

    watcher.on('session-expired', (sessionId) => {
      store.removeSession(sessionId)
    })

    watcher.on('subagent-discovered', async (sessionId, agentId, jsonlPath) => {
      await processSubagent(sessionId, agentId, jsonlPath)
    })

    watcher.on('subagent-updated', async (sessionId, agentId, jsonlPath) => {
      await processSubagent(sessionId, agentId, jsonlPath)
    })

    // Idle check timer
    const idleTimer = setInterval(() => store.tickIdleCheck(), 5000)

    // Refresh timer for elapsed time updates
    const refreshTimer = setInterval(() => {
      setSessions(store.getState())
    }, config.refreshInterval)

    const stop = watcher.start()
    setHooksActive(config.useHooks)

    return () => {
      stop()
      clearInterval(idleTimer)
      clearInterval(refreshTimer)
    }
  }, [])

  return (
    <Box flexDirection="column" height="100%">
      <Header sessions={sessions} hooksActive={hooksActive} lastUpdateMs={lastUpdateMs} />
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <SessionTree sessions={sessions} showCompleted={showCompleted} />
      </Box>
      <StatusBar hooksActive={hooksActive} showCompleted={showCompleted} />
    </Box>
  )
}
