import { watch, type FSWatcher } from 'fs'
import { stat, readdir } from 'fs/promises'
import { join } from 'path'
import { EventEmitter } from 'events'
import { discoverSessions, getSubagentFiles } from '../parser/session-discovery.ts'
import type { DiscoveredSession } from '../parser/session-discovery.ts'
import { HookReader } from './hook-reader.ts'

export interface FileWatcherEvents {
  'session-discovered': (session: DiscoveredSession) => void
  'session-updated': (sessionId: string, jsonlPath: string) => void
  'session-expired': (sessionId: string) => void
  'subagent-discovered': (sessionId: string, agentId: string, jsonlPath: string, metaPath: string | null) => void
  'subagent-updated': (sessionId: string, agentId: string, jsonlPath: string) => void
  'hook-event': (raw: string) => void
}

// Augment EventEmitter with typed overloads
export declare interface FileWatcher {
  on<K extends keyof FileWatcherEvents>(event: K, listener: FileWatcherEvents[K]): this
  emit<K extends keyof FileWatcherEvents>(event: K, ...args: Parameters<FileWatcherEvents[K]>): boolean
}

interface TrackedFile {
  path: string
  mtime: number
  watcher: FSWatcher | null
}

const SESSION_EXPIRY_MS = 20 * 60 * 1000
const DEBOUNCE_MS = 100
const POLL_INTERVAL_MS = 1000

export class FileWatcher extends EventEmitter {
  private readonly claudeDir: string
  private readonly monDir: string
  private readonly useHooks: boolean

  // sessionId → TrackedFile for the session JSONL
  private sessionFiles = new Map<string, TrackedFile>()
  // agentId → TrackedFile for subagent JSOLs
  private agentFiles = new Map<string, TrackedFile>()
  // sessionId → FSWatcher on the subagents/ directory
  private subagentDirWatchers = new Map<string, FSWatcher>()
  // projectsDir watcher
  private projectsDirWatcher: FSWatcher | null = null
  // poll interval handle
  private pollHandle: ReturnType<typeof setInterval> | null = null
  // debounce timers: key → timer handle
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // known sessions: sessionId → projectHash
  private knownSessions = new Map<string, string>()
  // hook reader
  private hookReader: HookReader | null = null

  constructor(config: { claudeDir: string; monDir: string; useHooks: boolean }) {
    super()
    this.claudeDir = config.claudeDir
    this.monDir = config.monDir
    this.useHooks = config.useHooks
  }

  /** Start watching. Returns a cleanup function. */
  start(): () => void {
    this.initialize().catch((err: unknown) => {
      console.error('[FileWatcher] init error:', err)
    })
    return () => this.stop()
  }

  /** Stop all watchers and polling */
  stop(): void {
    this.projectsDirWatcher?.close()
    this.projectsDirWatcher = null

    for (const tracked of this.sessionFiles.values()) {
      tracked.watcher?.close()
    }
    this.sessionFiles.clear()

    for (const tracked of this.agentFiles.values()) {
      tracked.watcher?.close()
    }
    this.agentFiles.clear()

    for (const w of this.subagentDirWatchers.values()) {
      w.close()
    }
    this.subagentDirWatchers.clear()

    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle)
      this.pollHandle = null
    }

    for (const t of this.debounceTimers.values()) {
      clearTimeout(t)
    }
    this.debounceTimers.clear()

    this.hookReader?.stop()
    this.hookReader = null
  }

  private async initialize(): Promise<void> {
    // Discover existing sessions
    const sessions = await discoverSessions(this.claudeDir)
    for (const session of sessions) {
      this.trackSession(session)
    }

    // Watch the projects directory for new subdirectories / new JSONL files
    const projectsDir = join(this.claudeDir, 'projects')
    try {
      this.projectsDirWatcher = watch(projectsDir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        this.debounce('projects-dir:' + filename, () => {
          this.onProjectsDirChange(filename).catch((err: unknown) => {
            console.error('[FileWatcher] projects dir change error:', err)
          })
        })
      })
      this.projectsDirWatcher.on('error', (err: Error) => {
        console.error('[FileWatcher] projects dir watcher error:', err.message)
      })
    } catch (err) {
      console.error('[FileWatcher] cannot watch projects dir:', (err as Error).message)
    }

    // Start polling fallback
    this.pollHandle = setInterval(() => {
      this.poll().catch((err: unknown) => {
        console.error('[FileWatcher] poll error:', err)
      })
    }, POLL_INTERVAL_MS)

    // Start hook reader if enabled
    if (this.useHooks) {
      this.hookReader = new HookReader(this.monDir)
      this.hookReader.start((raw) => {
        this.emit('hook-event', raw)
      })
    }
  }

  private trackSession(session: DiscoveredSession): void {
    const { sessionId, projectHash, jsonlPath, subagentFiles } = session

    if (this.knownSessions.has(sessionId)) return
    this.knownSessions.set(sessionId, projectHash)

    this.emit('session-discovered', session)

    // Track and watch the session JSONL
    this.trackJsonlFile(sessionId, jsonlPath, (path) => {
      this.emit('session-updated', sessionId, path)
    })

    // Watch for new subagent files
    const subagentsDir = join(
      this.claudeDir, 'projects', projectHash, sessionId, 'subagents'
    )
    this.watchSubagentsDir(sessionId, subagentsDir)

    // Track existing subagent files
    for (const sf of subagentFiles) {
      this.trackSubagentFile(sessionId, sf.agentId, sf.jsonlPath)
      this.emit('subagent-discovered', sessionId, sf.agentId, sf.jsonlPath, sf.metaPath)
    }
  }

  private trackJsonlFile(
    key: string,
    filePath: string,
    onChange: (path: string) => void,
  ): void {
    if (this.sessionFiles.has(key) || this.agentFiles.has(key)) return

    let watcher: FSWatcher | null = null
    try {
      watcher = watch(filePath, (_event) => {
        this.debounce('file:' + filePath, () => onChange(filePath))
      })
      watcher.on('error', (err: Error) => {
        console.error('[FileWatcher] file watcher error:', filePath, err.message)
      })
    } catch (err) {
      console.error('[FileWatcher] cannot watch file:', filePath, (err as Error).message)
    }

    const tracked: TrackedFile = { path: filePath, mtime: Date.now(), watcher }
    this.sessionFiles.set(key, tracked)
  }

  private trackSubagentFile(sessionId: string, agentId: string, jsonlPath: string): void {
    if (this.agentFiles.has(agentId)) return

    let watcher: FSWatcher | null = null
    try {
      watcher = watch(jsonlPath, (_event) => {
        this.debounce('agent:' + jsonlPath, () => {
          this.emit('subagent-updated', sessionId, agentId, jsonlPath)
        })
      })
      watcher.on('error', (err: Error) => {
        console.error('[FileWatcher] agent watcher error:', jsonlPath, err.message)
      })
    } catch (err) {
      console.error('[FileWatcher] cannot watch agent file:', jsonlPath, (err as Error).message)
    }

    this.agentFiles.set(agentId, { path: jsonlPath, mtime: Date.now(), watcher })
  }

  private watchSubagentsDir(sessionId: string, subagentsDir: string): void {
    if (this.subagentDirWatchers.has(sessionId)) return

    try {
      const w = watch(subagentsDir, (_event, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return
        this.debounce('subdir:' + sessionId + ':' + filename, () => {
          this.onSubagentsDirChange(sessionId, subagentsDir, filename!).catch((err: unknown) => {
            console.error('[FileWatcher] subagents dir change error:', err)
          })
        })
      })
      w.on('error', (_err: Error) => {
        // Subagents dir may not exist yet — ignore
      })
      this.subagentDirWatchers.set(sessionId, w)
    } catch {
      // Directory doesn't exist yet — poll will catch new files
    }
  }

  private async onProjectsDirChange(filename: string): Promise<void> {
    // filename may be "projectHash/sessionId.jsonl" or "projectHash"
    const parts = filename.split('/')
    if (parts.length < 1) return

    const projectHash = parts[0]
    const projectDir = join(this.claudeDir, 'projects', projectHash)

    try {
      const entries = await readdir(projectDir)
      const sessionFiles = entries.filter(e => /^[0-9a-f-]{36}\.jsonl$/.test(e))

      for (const sf of sessionFiles) {
        const jsonlPath = join(projectDir, sf)
        const sessionId = sf.replace(/\.jsonl$/, '')

        if (this.knownSessions.has(sessionId)) continue

        try {
          const fileStat = await stat(jsonlPath)
          const twoHoursAgo = Date.now() - SESSION_EXPIRY_MS
          if (fileStat.mtimeMs < twoHoursAgo) continue
        } catch {
          continue
        }

        const subagentFiles = await getSubagentFiles(join(projectDir, sessionId))
        const session: DiscoveredSession = {
          sessionId,
          projectHash,
          jsonlPath,
          subagentFiles,
          estimatedProjectPath: null,
        }
        this.trackSession(session)
      }
    } catch {
      // Directory may not exist or be readable — skip
    }
  }

  private async onSubagentsDirChange(
    sessionId: string,
    subagentsDir: string,
    filename: string,
  ): Promise<void> {
    const USER_AGENT_PATTERN = /^agent-a[a-f0-9]{15,}\.jsonl$/
    if (!USER_AGENT_PATTERN.test(filename)) return

    const jsonlPath = join(subagentsDir, filename)
    const agentId = filename.replace(/\.jsonl$/, '').replace(/^agent-/, '')

    if (this.agentFiles.has(agentId)) return

    // Look for meta file
    const metaFilename = filename.replace(/\.jsonl$/, '.meta.json')
    const metaPath = join(subagentsDir, metaFilename)
    let resolvedMetaPath: string | null = null
    try {
      await stat(metaPath)
      resolvedMetaPath = metaPath
    } catch {
      // No meta file
    }

    this.trackSubagentFile(sessionId, agentId, jsonlPath)
    this.emit('subagent-discovered', sessionId, agentId, jsonlPath, resolvedMetaPath)
  }

  /** Polling fallback: check mtime of tracked files and stale session cleanup */
  private async poll(): Promise<void> {
    const twoHoursAgo = Date.now() - SESSION_EXPIRY_MS

    // Check session files for mtime changes (fallback for systems where fs.watch is unreliable)
    for (const [sessionId, tracked] of this.sessionFiles) {
      try {
        const fileStat = await stat(tracked.path)
        if (fileStat.mtimeMs > tracked.mtime) {
          tracked.mtime = fileStat.mtimeMs
          this.emit('session-updated', sessionId, tracked.path)
        }
        // Close watcher and expire stale sessions (no activity for 2 hours)
        if (fileStat.mtimeMs < twoHoursAgo) {
          const wasWatching = tracked.watcher !== null
          if (tracked.watcher) {
            tracked.watcher.close()
            tracked.watcher = null
          }
          // Only emit once (when we first detect it's stale)
          if (wasWatching) {
            this.emit('session-expired', sessionId)
          }
        }
      } catch {
        // File gone — leave tracked but stop watching
        if (tracked.watcher) {
          tracked.watcher.close()
          tracked.watcher = null
        }
      }
    }

    // Check agent files similarly
    for (const [agentId, tracked] of this.agentFiles) {
      const sessionId = this.getSessionIdForAgent(agentId)
      if (!sessionId) continue

      try {
        const fileStat = await stat(tracked.path)
        if (fileStat.mtimeMs > tracked.mtime) {
          tracked.mtime = fileStat.mtimeMs
          this.emit('subagent-updated', sessionId, agentId, tracked.path)
        }
        if (fileStat.mtimeMs < twoHoursAgo && tracked.watcher) {
          tracked.watcher.close()
          tracked.watcher = null
        }
      } catch {
        if (tracked.watcher) {
          tracked.watcher.close()
          tracked.watcher = null
        }
      }
    }
  }

  private getSessionIdForAgent(agentId: string): string | null {
    // Look up agent's session by searching subagentDirWatchers keys
    // We stored agent files under agentId key; need reverse lookup from session tracking
    // The simplest approach: scan knownSessions and check agent's path
    const tracked = this.agentFiles.get(agentId)
    if (!tracked) return null

    for (const [sessionId] of this.knownSessions) {
      if (tracked.path.includes(sessionId)) return sessionId
    }
    return null
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key)
        fn()
      }, DEBOUNCE_MS),
    )
  }
}
