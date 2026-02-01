# CLAUDE.md

## Overview

Arc is an agentic coding orchestrator that uses Pi as its execution engine. It implements a planning-first approach with continuous iteration until tasks are complete.

**Architecture:**
```
Arc (planning, orchestration)
  → Pi (execution, LLM calls, tool use)
    → LLM (Claude, GPT, Gemini, etc.)
```

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
arc run plan.json                  # Execute plan (continuous)
arc run plan.json --crank          # Execute plan (hand-crank mode)
arc run plan.json --provider openai  # Use specific provider
arc status                         # Show execution status
```

## Project Structure

```
src/
├── cli.ts                    # Entry point, arg parsing
├── commands/
│   ├── plan.tsx              # Planning UI (Ink/React)
│   └── run.tsx               # Execution UI (Ink/React)
├── pi/
│   ├── index.ts              # Module exports
│   ├── types.ts              # Pi event types
│   ├── events.ts             # Event parsing utilities
│   └── spawn.ts              # Process spawning
├── core/
│   └── loop.ts               # Ralph loop implementation (Phase 2)
└── types/
    ├── plan.ts               # Plan/Step types
    └── events.ts             # Arc event types
```

## Pi Integration

Arc spawns Pi as a subprocess using JSON mode:

```bash
pi --mode json --no-session -p "Execute this step: ..."
```

Pi emits events as JSON lines:
- `text_delta` - Streaming text output
- `toolcall_start/end` - Tool invocations
- `tool_result` - Tool outputs
- `done` - Completion with reason
- `error` - Errors

Arc streams these to its TUI and aggregates results.

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

Pi handles LLM authentication. Set up via:
```bash
pi
/login  # OAuth for subscriptions (Claude Pro, ChatGPT Plus, etc.)
```

Or use API keys:
```bash
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
- [ ] Phase 2: Ralph loop (iteration until done)
- [ ] Phase 3: Multi-agent swarm

## Dependencies

- **@mariozechner/pi-coding-agent** - Pi coding agent
- **effect** - Functional programming
- **ink** - React for CLI
- **react** - UI components
