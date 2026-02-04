# Arc ⚡

> Rapid iteration product development agent.

**Idea → Plan a piece → Build → Verify → Learn → Repeat**

Arc is an AI-powered coding orchestrator that emphasizes small, verified increments over big upfront planning. It wraps coding agents (Claude Code, Codex, Pi, OpenCode) in a verification loop that iterates until tasks are complete.

## Philosophy

```
Plan a little, build a little, learn, repeat.
```

- **No big upfront planning** — plan just the next piece
- **Verification-driven** — tasks need acceptance criteria to auto-verify
- **Learn from failures** — each retry includes context from previous attempts
- **Track progress** — insights and learnings persist across sessions

## Quick Start

```bash
# Install
bun install

# Initialize a project
arc init "Build a REST API for a todo app"

# Add tasks with verification
arc add "Set up Express server" --verify "curl -s localhost:3000/health"
arc add "Create Todo CRUD API" --verify "bun test src/todo.test.ts"

# Run one iteration
arc iterate

# Or keep going until done
arc go

# Check progress
arc status
```

## Commands

| Command | Description |
|---------|-------------|
| `arc init "<goal>"` | Initialize a project with a goal |
| `arc add "<task>" --verify "<cmd>"` | Add task with verification |
| `arc iterate` | Run one iteration |
| `arc go` | Keep iterating until done |
| `arc status` | Show project progress |
| `arc backlog` | Show task list |
| `arc insights` | Show learnings |

## Verification

Tasks with verification commands (`--verify`) run in the Ralph loop:

```
Build → Run verify command → Pass? ✓ Done : Retry with context
```

Tasks without verification complete after one attempt but are flagged for manual review.

```bash
# ✅ Good - can auto-verify
arc add "Build health endpoint" --verify "curl -s localhost:3000/health"

# ⚠️ Needs manual review
arc add "Write documentation"
```

## Supported Agents

| Agent | Description | Flag |
|-------|-------------|------|
| Claude Code | Anthropic Claude | `--agent claude-code` (default) |
| Codex | OpenAI Codex CLI | `--agent codex` |
| Pi | Multi-provider agent | `--agent pi` |
| OpenCode | Open-source agent | `--agent opencode` |

## Project Structure

```
arc/
├── src/
│   ├── cli.ts                 # Command-line interface
│   ├── commands/              # Command implementations
│   │   ├── init.ts           # arc init
│   │   ├── add.ts            # arc add
│   │   ├── iterate.ts        # arc iterate
│   │   ├── go.ts             # arc go
│   │   ├── status.ts         # arc status
│   │   └── ...
│   ├── core/
│   │   ├── iterate.ts        # Iteration loop
│   │   ├── project-store.ts  # Project persistence
│   │   └── ...
│   ├── agents/               # Agent abstraction layer
│   │   ├── types.ts          # Agent types
│   │   └── spawn.ts          # PTY spawning
│   └── types/
│       └── project.ts        # Project/Task/Insight types
├── specs/                     # Design specifications
│   └── README.md             # Spec index
└── arc-project.json          # Your project state (created by arc init)
```

## Specifications

Design documentation lives in `specs/`. See [specs/README.md](./specs/README.md) for a complete index.

Key specs:
- [ITERATION-LOOP](./specs/ITERATION-LOOP.md) — The core development loop
- [PROJECT-MODEL](./specs/PROJECT-MODEL.md) — Data structures
- [VERIFICATION](./specs/VERIFICATION.md) — How tasks are verified
- [AGENT-ABSTRACTION](./specs/AGENT-ABSTRACTION.md) — Multi-agent support

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev

# Type check
bun run typecheck

# Run tests
bun test
```

## Architecture

```
Arc (orchestration, iteration loop)
  → Agent (Codex, Claude Code, OpenCode, Pi)
    → LLM (Claude, GPT, Gemini, etc.)
```

Arc provides the structure. Agents do the coding. The loop keeps going until verification passes.

## Inspiration

- [Geoff Huntley's Ralph](https://ghuntley.com/ralph) — The original technique
- [OpenClaw](https://github.com/openclaw/openclaw) — Agent infrastructure

---

*"Plan a little, build a little, learn, repeat."* ⚡
