import React, { useState, useEffect } from 'react'
import { Box, useApp, useInput } from 'ink'
import { readFile } from 'fs/promises'
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
    if (input === 'h') setHooksActive(v => !v)
  })

  useEffect(() => {
    const store = new StateStore(config)
    const watcher = new FileWatcher(config)

    // Track file offsets for incremental parsing
    const offsets = new Map<string, number>()
    // sessionId → Map<hexId, resolvedToolUseId>
    const subagentIdMap = new Map<string, Map<string, string>>()
    // sessionId → deferred subagents waiting for agent_spawned from parent JSONL
    const pendingSubagents = new Map<string, Array<{
      hexId: string
      jsonlPath: string
      agentType?: string
      description?: string
    }>>()
    // sessionId → all file paths accessed (for offset cleanup on session-expired)
    const sessionFilePaths = new Map<string, string[]>()

    function trackFilePath(sessionId: string, filePath: string) {
      const paths = sessionFilePaths.get(sessionId) ?? []
      if (!paths.includes(filePath)) {
        paths.push(filePath)
        sessionFilePaths.set(sessionId, paths)
      }
    }

    async function readMetaJson(p: string): Promise<{ agentType?: string; description?: string } | null> {
      try { return JSON.parse(await readFile(p, 'utf-8')) } catch { return null }
    }

    async function processFile(sessionId: string, filePath: string) {
      trackFilePath(sessionId, filePath)
      const offset = offsets.get(filePath) ?? 0
      const { events, newOffset } = await parseJsonlIncremental(filePath, offset, sessionId)
      offsets.set(filePath, newOffset)
      const t0 = Date.now()
      events.forEach(e => store.applyEvent(e))
      setLastUpdateMs(Date.now() - t0)
    }

    async function processSubagent(sessionId: string, agentId: string, filePath: string) {
      trackFilePath(sessionId, filePath)
      const offset = offsets.get(filePath) ?? 0
      const { events, newOffset } = await parseSubagentJsonl(filePath, agentId, sessionId, offset)
      offsets.set(filePath, newOffset)
      events.forEach(e => store.applyEvent(e))
    }

    // Resolve hexId → tool_use_id and process subagent file.
    // If no match yet, defer to pendingSubagents (drained on next session-updated).
    // Never passes hexId to processSubagent — avoids orphan agent records.
    async function resolveAndProcessSubagent(
      sessionId: string,
      hexId: string,
      jsonlPath: string,
      agentType?: string,
      description?: string,
    ) {
      let sessionMap = subagentIdMap.get(sessionId)
      let resolvedId = sessionMap?.get(hexId)

      if (!resolvedId) {
        resolvedId = store.matchSubagent(sessionId, agentType, description)
        if (resolvedId) {
          if (!sessionMap) { sessionMap = new Map(); subagentIdMap.set(sessionId, sessionMap) }
          sessionMap.set(hexId, resolvedId)
        }
      }

      if (resolvedId) {
        await processSubagent(sessionId, resolvedId, jsonlPath)
      } else {
        // Defer — agent_spawned not yet applied from parent JSONL
        const pending = pendingSubagents.get(sessionId) ?? []
        if (!pending.some(p => p.hexId === hexId)) {
          pending.push({ hexId, jsonlPath, agentType, description })
          pendingSubagents.set(sessionId, pending)
        }
      }
    }

    // Drain deferred subagents after processFile has applied agent_spawned events
    async function drainPendingSubagents(sessionId: string) {
      const pending = pendingSubagents.get(sessionId)
      if (!pending?.length) return
      const remaining: typeof pending = []
      for (const sub of pending) {
        const resolvedId = store.matchSubagent(sessionId, sub.agentType, sub.description)
        if (resolvedId) {
          const sm = subagentIdMap.get(sessionId) ?? new Map<string, string>()
          sm.set(sub.hexId, resolvedId)
          subagentIdMap.set(sessionId, sm)
          await processSubagent(sessionId, resolvedId, sub.jsonlPath)
        } else {
          remaining.push(sub)
        }
      }
      if (remaining.length) pendingSubagents.set(sessionId, remaining)
      else pendingSubagents.delete(sessionId)
    }

    store.on('state-changed', () => {
      setSessions(store.getState())
    })

    watcher.on('session-discovered', async (discovered) => {
      await processFile(discovered.sessionId, discovered.jsonlPath)
      // session-discovery.ts already parsed meta.json → SubagentFile has agentType/description
      for (const sub of discovered.subagentFiles) {
        await resolveAndProcessSubagent(
          discovered.sessionId, sub.agentId, sub.jsonlPath,
          sub.agentType ?? undefined, sub.description ?? undefined,
        )
      }
    })

    watcher.on('session-updated', async (sessionId, jsonlPath) => {
      await processFile(sessionId, jsonlPath)
      await drainPendingSubagents(sessionId)  // retry after agent_spawned events applied
    })

    watcher.on('session-expired', (sessionId) => {
      store.removeSession(sessionId)
      pendingSubagents.delete(sessionId)
      subagentIdMap.delete(sessionId)
      const paths = sessionFilePaths.get(sessionId) ?? []
      for (const p of paths) offsets.delete(p)
      sessionFilePaths.delete(sessionId)
    })

    watcher.on('subagent-discovered', async (sessionId, hexId, jsonlPath, metaPath) => {
      const meta = metaPath ? await readMetaJson(metaPath) : null
      await resolveAndProcessSubagent(sessionId, hexId, jsonlPath, meta?.agentType, meta?.description)
    })

    watcher.on('subagent-updated', async (sessionId, hexId, jsonlPath) => {
      // Only process if already resolved — if not, session-updated drain will handle it
      const resolvedId = subagentIdMap.get(sessionId)?.get(hexId)
      if (resolvedId) await processSubagent(sessionId, resolvedId, jsonlPath)
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
