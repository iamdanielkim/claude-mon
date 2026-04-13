import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface SetupOptions {
  remove?: boolean
  claudeDir?: string
}

const HOOK_MARKER = '# claude-mon hook'

export async function setupHooks(options: SetupOptions = {}): Promise<void> {
  const claudeDir = options.claudeDir ?? join(homedir(), '.claude')
  const monDir = join(claudeDir, 'mon')
  const settingsPath = join(claudeDir, 'settings.json')
  const hookScriptPath = join(monDir, 'hook.sh')

  if (options.remove) {
    await removeHooks(settingsPath)
    return
  }

  // 1. Create mon directory
  mkdirSync(monDir, { recursive: true })

  // 2. Install hook script
  const hookScript = generateHookScript()
  writeFileSync(hookScriptPath, hookScript, { mode: 0o755 })
  console.log(`✓ Hook script installed: ${hookScriptPath}`)

  // 3. Update settings.json
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch {
      console.error(`Warning: Could not parse ${settingsPath}, creating fresh hook config`)
    }
  }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {}

  // Add PreToolUse hook if not already present
  const preHooks = (hooks.PreToolUse as unknown[] | undefined) ?? []
  if (!preHooks.some((h: unknown) => JSON.stringify(h).includes(HOOK_MARKER))) {
    preHooks.push({
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `bash "${hookScriptPath}" pre "$TOOL_NAME" "$CLAUDE_SESSION_ID" ${HOOK_MARKER}`
      }]
    })
  }

  // Add PostToolUse hook if not already present
  const postHooks = (hooks.PostToolUse as unknown[] | undefined) ?? []
  if (!postHooks.some((h: unknown) => JSON.stringify(h).includes(HOOK_MARKER))) {
    postHooks.push({
      matcher: '*',
      hooks: [{
        type: 'command',
        command: `bash "${hookScriptPath}" post "$TOOL_NAME" "$CLAUDE_SESSION_ID" ${HOOK_MARKER}`
      }]
    })
  }

  settings.hooks = { ...hooks, PreToolUse: preHooks, PostToolUse: postHooks }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`✓ Hooks added to: ${settingsPath}`)
  console.log(`\nRun 'claude-mon' in a separate terminal to start monitoring.`)
  console.log(`Events will stream to: ${join(monDir, 'events.jsonl')}`)
}

async function removeHooks(settingsPath: string): Promise<void> {
  if (!existsSync(settingsPath)) {
    console.log('No settings.json found, nothing to remove.')
    return
  }

  const settings: Record<string, unknown> = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const hooks = settings.hooks as Record<string, unknown[]> | undefined
  if (!hooks) {
    console.log('No hooks configured, nothing to remove.')
    return
  }

  function filterHooks(arr: unknown[]): unknown[] {
    return arr.filter((h: unknown) => !JSON.stringify(h).includes(HOOK_MARKER))
  }

  if (hooks.PreToolUse) hooks.PreToolUse = filterHooks(hooks.PreToolUse)
  if (hooks.PostToolUse) hooks.PostToolUse = filterHooks(hooks.PostToolUse)

  // Clean up empty arrays
  if (hooks.PreToolUse?.length === 0) delete hooks.PreToolUse
  if (hooks.PostToolUse?.length === 0) delete hooks.PostToolUse
  if (Object.keys(hooks).length === 0) delete settings.hooks

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`✓ claude-mon hooks removed from: ${settingsPath}`)
}

function generateHookScript(): string {
  return `#!/bin/bash
# claude-mon hook script — appends events to ~/.claude/mon/events.jsonl
# Installed by: claude-mon setup-hooks

EVENT_TYPE="\${1:-unknown}"
TOOL_NAME="\${2:-unknown}"
SESSION_ID="\${3:-unknown}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
MON_DIR="$HOME/.claude/mon"
EVENTS_FILE="$MON_DIR/events.jsonl"

# Create mon dir if it doesn't exist
mkdir -p "$MON_DIR"

# Append event as JSON line (fire and forget — don't block Claude Code)
printf '{"source":"hook","eventType":"%s","toolName":"%s","sessionId":"%s","ts":"%s"}\\n' \\
  "$EVENT_TYPE" "$TOOL_NAME" "$SESSION_ID" "$TIMESTAMP" >> "$EVENTS_FILE" 2>/dev/null || true
`
}
