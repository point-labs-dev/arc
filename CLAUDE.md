# CLAUDE.md

## Overview

Arc is an agentic coding orchestrator with a planning-first approach. It has two distinct phases:

1. **Planning Phase** - Interactive UI to collaboratively build and refine a plan with an AI agent
2. **Execution Phase** - Arc loop that executes the plan until complete

## Philosophy

Based on [Geoff Huntley's theories](https://ghuntley.com/ralph):

> "The technique is deterministically bad in an undeterministic world."

> "Each time it does something bad, it gets tuned - like a guitar."

Key principles:
- **Eventual consistency** - Faith that the loop will converge
- **Observability** - See everything the agent does
- **Hand-cranking** - Manual iteration for tuning and learning
- **Verification** - QA, testing, and review built into every iteration

## Execution Modes

### Arc Mode (Continuous)
```bash
arc run plan.json
```
Runs the loop until the plan is complete or circuit breaker triggers.

### Hand-Crank Mode
```bash
arc run plan.json --crank
```
Executes one iteration, shows full output, waits for user input:
- `[c]ontinue` - Run next iteration
- `[r]eview` - Review changes before continuing
- `[t]une` - Modify the prompt/context
- `[s]top` - Stop execution

## Commands

```bash
arc plan                    # Start planning UI
arc plan --load plan.json   # Resume existing plan
arc run plan.json           # Execute plan (Arc mode)
arc run plan.json --crank   # Execute plan (Hand-crank mode)
arc status                  # Show current execution status
```

## Project Structure

```
src/
├── cli.ts                    # Entry point
├── commands/
│   ├── plan.ts               # Planning command
│   └── run.ts                # Execution command
├── core/
│   ├── loop.ts               # Arc loop implementation
│   ├── planner.ts            # Plan management
│   ├── executor.ts           # Step execution
│   └── verifier.ts           # QA and verification
├── llm/
│   ├── service.ts            # LLM service interface
│   ├── providers/
│   │   ├── anthropic.ts      # Claude provider
│   │   └── openai.ts         # OpenAI provider
│   └── context.ts            # Context management
├── ui/
│   ├── plan/                 # Planning TUI (Ink/React)
│   │   ├── App.tsx
│   │   ├── Chat.tsx
│   │   ├── PlanView.tsx
│   │   └── StepEditor.tsx
│   └── run/                  # Execution TUI
│       ├── App.tsx
│       ├── Output.tsx
│       └── Controls.tsx
├── types/
│   ├── plan.ts               # Plan types
│   ├── step.ts               # Step types
│   └── events.ts             # Event types
└── utils/
    ├── files.ts              # File operations
    └── git.ts                # Git operations
```

## Code Style

### Effect.ts Patterns

Use `Effect.gen` for sequential operations:
```typescript
const program = Effect.gen(function* () {
  const llm = yield* LLMService
  const result = yield* llm.complete(request)
  return result
})
```

Tagged errors with `Data.TaggedError`:
```typescript
class PlanError extends Data.TaggedError("PlanError")<{
  message: string
  step?: string
}> {}
```

### React/Ink Patterns

Functional components with hooks:
```typescript
const Chat: React.FC<Props> = ({ onMessage }) => {
  const [input, setInput] = useState("")
  // ...
}
```

## Plan Format

```json
{
  "id": "plan-uuid",
  "name": "Feature Name",
  "description": "What we're building",
  "context": {
    "files": ["src/main.ts", "README.md"],
    "notes": "Additional context..."
  },
  "steps": [
    {
      "id": "step-1",
      "description": "Implement the core logic",
      "verification": {
        "command": "bun test",
        "expect": "exit_code_0"
      },
      "status": "pending"
    }
  ],
  "created": "2024-01-31T23:00:00Z",
  "updated": "2024-01-31T23:30:00Z"
}
```

## Verification Types

Each step can have verification:
- `exit_code_0` - Command exits with code 0
- `output_contains` - Output contains expected string
- `file_exists` - File exists after step
- `file_contains` - File contains expected content
- `manual` - Requires manual approval

## Context Management

Context is managed per-iteration:
- **Static context** - Files, notes from plan
- **Dynamic context** - Previous iteration output, errors
- **Compaction** - Summarize old iterations to save tokens

## Testing

```bash
bun test                      # Run all tests
bun test src/core             # Run core tests
bun test --watch              # Watch mode
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key |
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `ARC_PROVIDER` | No | Default: anthropic |
| `ARC_MODEL` | No | Default: claude-sonnet-4-20250514 |

*At least one API key required
