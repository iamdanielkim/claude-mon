# claude-mon

`top`-like terminal UI for monitoring Claude Code sessions and subagents in real-time.

```
claude-mon                    2 sessions | 4 agents | refresh: 12ms | hooks: inactive

└ my-project
  ├── ● planner              claude-sonnet-4-6   Bash         2m14s   45.2K   $0.18
  └── ● executor             claude-opus-4-6     Write        5m01s  128.4K   $2.14

└ other-project
  └── ● explore              claude-haiku-4-5    Read         0m12s   12.1K    N/A

[q] quit  [c] toggle completed  [h] hooks status     Data: JSONL | completed: shown
```

## Features

- Session and subagent tree — shows all running Claude Code sessions with their spawned agents
- Per-agent columns: status | agent type | model | current tool | elapsed time | tokens | estimated cost
- Non-Anthropic models display `N/A` for cost
- Zero-config JSONL mode reads `~/.claude/projects/` directly — no setup required
- Optional hooks mode for real-time tool tracking
- Hotkeys: toggle completed agents, quit cleanly

## Installation

**Option 1: Run directly (no install)**

```bash
bun run /path/to/claude-mon/src/cli.ts
```

**Option 2: Global link (run `claude-mon` from anywhere)**

```bash
git clone https://github.com/your-username/claude-mon.git
cd claude-mon
bun install
bun link
```

After linking, use `claude-mon` from any terminal.

**Option 3: npx / bunx (once published to npm)**

```bash
bunx claude-mon
```

## Usage

```bash
# Start the monitor in a separate terminal while Claude Code is running
claude-mon

# Customize refresh interval (default: 1000ms)
claude-mon --refresh 500

# Disable hook event reading
claude-mon --no-hooks

# Set up optional hooks for richer monitoring (one-time setup)
claude-mon setup-hooks

# Remove hooks
claude-mon setup-hooks --remove
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `c` | Toggle completed agents visibility |
| `h` | Toggle hooks status |

## Data Sources

### JSONL mode (default, zero-config)

Reads Claude Code session logs from `~/.claude/projects/**/*.jsonl`. Works immediately with no configuration — just run `claude-mon` alongside Claude Code.

### Hooks mode (optional, richer data)

Run `claude-mon setup-hooks` once to install PreToolUse/PostToolUse hooks into `~/.claude/settings.json`. Hook events stream to `~/.claude/mon/events.jsonl` and give more precise tool-use start/end timing.

To uninstall: `claude-mon setup-hooks --remove`

## Development

**Requirements**

- [Bun](https://bun.sh) >= 1.0.0
- Claude Code (for live data to monitor)

**Setup**

```bash
git clone https://github.com/your-username/claude-mon.git
cd claude-mon
bun install
```

**Run from source**

```bash
bun run src/cli.ts
```

**Type check**

```bash
bunx tsc --noEmit
```

**Project structure**

```
src/
├── cli.ts              # Entry point, argument parsing
├── monitor.ts          # Wires all components, renders TUI
├── types.ts            # All TypeScript interfaces and ParsedEvent union
├── parser/
│   ├── jsonl-parser.ts     # Incremental JSONL parsing, emits ParsedEvent[]
│   ├── session-discovery.ts # Scans ~/.claude/projects/ for sessions
│   ├── agent-extractor.ts  # Parses subagent JSONL files
│   └── pricing.ts          # Model cost calculation (prefix-matching)
├── state/
│   └── store.ts            # StateStore: centralized Map<sessionId, Session>
├── watcher/
│   ├── file-watcher.ts     # fs.watch-based watcher for new sessions/agents
│   └── hook-reader.ts      # Tails ~/.claude/mon/events.jsonl
├── ui/
│   ├── App.tsx             # Root ink component, keyboard handlers
│   ├── Header.tsx          # Top bar with session/agent counts
│   ├── SessionTree.tsx     # Session + agent tree rendering
│   ├── AgentRow.tsx        # Single agent row with all columns
│   ├── StatusBar.tsx       # Bottom status line
│   └── theme.ts            # Colors, icons, column widths
└── hooks/
    └── setup.ts            # setup-hooks command implementation
```

## License

MIT
