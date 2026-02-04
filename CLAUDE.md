# CLAUDE.md

## Overview

Arc is an agentic coding orchestrator with an **agent-agnostic** execution layer. It implements a planning-first approach with continuous iteration until tasks are complete.

**Architecture:**
```
Arc (planning, orchestration, Ralph loop)
  → Agent (Codex, Claude Code, OpenCode, Pi)
    → LLM (Claude, GPT, Gemini, etc.)
```

**Supported Agents:**
- **Codex** - OpenAI's coding agent (gpt-5.2-codex) [default]
- **Claude Code** - Anthropic's Claude coding assistant
- **OpenCode** - Open-source coding agent
- **Pi** - Mario Zechner's multi-provider coding agent

## Philosophy

> "Energy in, shaped code out. Iteration over iteration until it's right."

Arc wraps Pi in a loop that runs until the task is complete. Like:
- An **electric arc** transforming energy into shaped metal
- An **architectural arc** providing structure
- A **story arc** progressing toward completion

Key principles:
- **Planning first** - Break work into verifiable steps before executing
- **Iteration** - Loop until done, not one-shot
- **Verification** - Every step has a success criteria
- **Observability** - See exactly what the agent does
- **Hand-cranking** - Pause to tune when needed

## Execution Flow

```
arc run plan.json
│
├── Load plan
├── For each step:
│   ├── Build prompt from step + context
│   ├── Spawn Pi (--mode json --no-session)
│   ├── Stream Pi events to UI
│   ├── Run verification command
│   ├── Update step status (pass/fail)
│   └── If crank mode: pause for user
│
└── Report results
```

## Commands

```bash
arc plan                           # Start planning UI
arc plan --load plan.json          # Resume existing plan
arc run plan.json                  # Execute plan (default: codex)
arc run plan.json --agent pi       # Execute with Pi
arc run plan.json --agent codex    # Execute with Codex
arc run plan.json --agent claude-code  # Execute with Claude Code
arc run plan.json --crank          # Execute with hand-crank mode
arc run plan.json --auto-approve   # Auto-approve changes (--yolo)
arc run plan.json --agent pi --provider openai  # Pi with OpenAI
arc status                         # Show execution status
```

## Project Structure

```
src/
├── cli.ts                    # Entry point, arg parsing
├── commands/
│   ├── plan.tsx              # Planning UI (Ink/React)
│   └── run.tsx               # Execution UI (Ink/React)
├── agents/                   # Agent-agnostic execution layer
│   ├── index.ts              # Module exports
│   ├── types.ts              # Agent types, config, errors
│   └── spawn.ts              # PTY-based process spawning
├── pi/                       # Legacy Pi-specific module (deprecated)
│   ├── index.ts              # Module exports
│   ├── types.ts              # Pi event types
│   ├── events.ts             # Event parsing utilities
│   └── spawn.ts              # Process spawning (JSON mode)
├── core/
│   ├── ralph.ts              # Ralph loop implementation
│   ├── diff.ts               # Git diff tracking
│   └── loop.ts               # Legacy loop (Phase 1)
└── types/
    ├── plan.ts               # Plan/Step types
    └── events.ts             # Arc event types
```

## Agent Integration

Arc spawns coding agents as subprocesses using PTY (pseudo-terminal) for proper terminal emulation:

```typescript
// Codex
codex exec --yolo "Execute this step: ..."

// Claude Code
claude "Execute this step: ..."

// OpenCode
opencode run "Execute this step: ..."

// Pi
pi -p "Execute this step: ..."
```

**Agent Selection:**
```typescript
interface AgentConfig {
  agent: "codex" | "claude-code" | "opencode" | "pi"
  cwd: string
  autoApprove?: boolean  // --yolo mode
  timeout?: number
  provider?: string      // For Pi
  model?: string         // For Pi
}
```

Arc streams stdout to its TUI and tracks exit codes for verification.

## Plan Format

```json
{
  "id": "uuid",
  "name": "Feature Name",
  "description": "What we're building",
  "context": {
    "files": ["src/main.ts"],
    "notes": "Additional context",
    "techStack": ["typescript", "effect"],
    "constraints": ["No external dependencies"]
  },
  "steps": [
    {
      "id": "step-1",
      "description": "Implement the core logic",
      "details": "More detailed instructions...",
      "verification": {
        "type": "exit_code_0",
        "command": "bun test"
      },
      "status": "pending"
    }
  ]
}
```

## Verification Types

- `exit_code_0` - Command exits with code 0
- `output_contains` - Output contains expected string
- `file_exists` - File exists after step
- `file_contains` - File contains expected content
- `manual` - Requires manual approval

## Code Style

### Effect.ts Patterns

Use `Effect.gen` for sequential operations:
```typescript
const program = Effect.gen(function* () {
  const result = yield* runPi(prompt, config)
  return result
})
```

Tagged errors with `Data.TaggedError`:
```typescript
class PiSpawnError extends Data.TaggedError("PiSpawnError")<{
  message: string
}> {}
```

### React/Ink Patterns

Functional components with hooks:
```typescript
const RunApp: React.FC<Props> = ({ plan, config, onComplete }) => {
  const [state, setState] = useState(...)
  // ...
}
```

## Environment

Each agent handles its own LLM authentication:

**Codex:**
```bash
export OPENAI_API_KEY=sk-...
# Or use ~/.codex/config.toml
```

**Claude Code:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Pi:**
```bash
pi
/login  # OAuth for subscriptions (Claude Pro, ChatGPT Plus, etc.)
# Or API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

## Development

```bash
bun install                   # Install dependencies
bun run dev                   # Run in dev mode
bun run typecheck             # Type check
bun test                      # Run tests
bun run build                 # Build for distribution
```

## Roadmap

- [x] Phase 1: Pi as execution engine
- [x] Phase 2: Ralph loop (iteration until done)
- [x] Phase 2.5: Agent-agnostic execution (Codex, Claude Code, OpenCode, Pi)
- [ ] Phase 3: Multi-agent swarm
- [ ] Phase 4: OpenClaw integration

## Dependencies

- **effect** - Functional programming
- **ink** - React for CLI
- **react** - UI components
- **node-pty** - PTY spawning for terminal emulation
