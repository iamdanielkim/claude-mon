# claude-mon

`top`-like terminal UI for monitoring Claude Code sessions and subagents in real-time.

![claude-mon screenshot](https://raw.githubusercontent.com/iamdanielkim/claude-mon/main/assets/screenshot.png)



## Features

- Session and subagent tree — shows all running Claude Code sessions with their spawned agents
- Per-agent columns: status | agent type | model | current tool | elapsed time | tokens | estimated cost
- Non-Anthropic models display `N/A` for cost
- Zero-config JSONL mode reads `~/.claude/projects/` directly — no setup required
- Optional hooks mode for real-time tool tracking
- Hotkeys: toggle completed agents, quit cleanly

## Installation

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
