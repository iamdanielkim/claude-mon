import { existsSync, openSync, readSync, closeSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Tails ~/.claude/mon/events.jsonl for hook events.
 * Gracefully degrades when the file does not exist.
 */
export class HookReader {
  private readonly eventsPath: string
  private offset = 0
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(monDir: string) {
    this.eventsPath = join(monDir, 'events.jsonl')
  }

  /**
   * Start tailing events.jsonl. Returns false if the file does not exist.
   */
  start(onEvent: (raw: string) => void): boolean {
    if (!existsSync(this.eventsPath)) {
      return false
    }

    // Start from end of file so we only see new events
    try {
      const st = statSync(this.eventsPath)
      this.offset = st.size
    } catch {
      this.offset = 0
    }

    this.intervalId = setInterval(() => {
      this.poll(onEvent)
    }, 200)

    return true
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private poll(onEvent: (raw: string) => void): void {
    try {
      const fd = openSync(this.eventsPath, 'r')
      const chunkSize = 65536
      const buf = Buffer.alloc(chunkSize)
      let accumulated = ''

      while (true) {
        const bytesRead = readSync(fd, buf, 0, chunkSize, this.offset)
        if (bytesRead === 0) break
        accumulated += buf.slice(0, bytesRead).toString('utf-8')
        this.offset += bytesRead
      }

      closeSync(fd)

      if (accumulated.length === 0) return

      const lines = accumulated.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length > 0) {
          onEvent(trimmed)
        }
      }
    } catch {
      // Permission denied or file disappeared — skip silently
    }
  }
}
