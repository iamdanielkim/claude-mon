#!/usr/bin/env bun
import { parseArgs } from 'util'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    'no-hooks': { type: 'boolean', default: false },
    refresh: { type: 'string', default: '1000' },
    json: { type: 'boolean', default: false },
    remove: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(`claude-mon - real-time monitor for Claude Code sessions

Usage: claude-mon [options] [command]

Commands:
  (default)      Start the TUI monitor
  setup-hooks    Configure Claude Code hooks for richer monitoring

Options:
  -h, --help     Show this help
  --no-hooks     Disable hook event reading
  --refresh <ms> Refresh interval in milliseconds (default: 1000)
  --json         Output as JSON instead of TUI (not yet implemented)
`)
  process.exit(0)
}

const command = positionals[0]

if (command === 'setup-hooks') {
  const remove = values.remove ?? false
  const { setupHooks } = await import('./hooks/setup.ts')
  await setupHooks({ remove })
} else {
  // Default: start TUI monitor
  const refreshInterval = parseInt(values.refresh ?? '1000', 10)
  const useHooks = !(values['no-hooks'] ?? false)

  const { startMonitor } = await import('./monitor.ts')
  await startMonitor({ refreshInterval, useHooks })
}
