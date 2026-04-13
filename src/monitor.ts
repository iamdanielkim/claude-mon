import React from 'react'
import { render } from 'ink'
import { homedir } from 'os'
import path from 'path'
import type { MonitorConfig } from './types.ts'
import { App } from './ui/App.tsx'

export async function startMonitor(options: { refreshInterval: number; useHooks: boolean }): Promise<void> {
  const claudeDir = path.join(homedir(), '.claude')
  const config: MonitorConfig = {
    claudeDir,
    monDir: path.join(claudeDir, 'mon'),
    refreshInterval: options.refreshInterval,
    useHooks: options.useHooks,
    showCompleted: true,
    maxIdleTime: 30_000,
  }

  const { waitUntilExit } = render(React.createElement(App, { config }))

  // Handle clean exit
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))

  await waitUntilExit()
}
