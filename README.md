# Arc ⚡

> Energy in, shaped code out. Iteration over iteration until it's right.

An agentic coding orchestrator with a planning-first approach.

## Philosophy

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Arc is a technique. In its purest form, it's a loop. The beauty of Arc is that it's **deterministically bad in an undeterministic world**.

Each time Arc does something wrong, you tune it—like a guitar. Eventually, Arc learns all the signs.

## Why "Arc"?

- ⚡ **Electric arc** — energy/tokens transformed into output
- 📐 **Architecture** — design thinking, structured approach
- 🏛️ **Pointed arch** — the foundation of Point Labs
- 📈 **Story arc** — iteration toward completion

## Features

- **Planning Phase** - Interactive UI to build execution plans collaboratively with AI
- **Execution Phase** - Arc loop that runs until the plan is complete
- **Hand-Crank Mode** - Pause after each iteration to observe and tune
- **Full Observability** - See everything the agent does
- **Verification** - QA, testing, and review built into every step

## Quick Start

```bash
# Install dependencies
bun install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start planning
bun run plan

# Execute a plan (continuous mode)
bun run run plan.json

# Execute with hand-cranking
bun run crank plan.json
```

## Modes

### Continuous Mode (Arc Mode)
```bash
arc run plan.json
```
Runs the loop until the plan is complete or the circuit breaker triggers.

### Hand-Crank Mode
```bash
arc run plan.json --crank
```
Pauses after each iteration. Options:
- `[C]ontinue` - Run next iteration
- `[R]eview` - Review changes before continuing  
- `[T]une` - Modify the prompt/context
- `[S]top` - Stop execution

## Commands

| Command | Description |
|---------|-------------|
| `arc plan` | Start planning UI |
| `arc plan --load plan.json` | Resume existing plan |
| `arc run plan.json` | Execute plan (continuous) |
| `arc run plan.json --crank` | Execute plan (hand-crank) |
| `arc status` | Show execution status |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key |
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `ARC_PROVIDER` | No | Default: `anthropic` |
| `ARC_MODEL` | No | Default: `claude-sonnet-4-20250514` |

\* At least one API key is required

## Plan Format

```json
{
  "id": "uuid",
  "name": "Feature Name",
  "description": "What we're building",
  "context": {
    "files": ["src/main.ts"],
    "notes": "Additional context"
  },
  "steps": [
    {
      "id": "step-1",
      "description": "Implement the core logic",
      "verification": {
        "type": "exit_code_0",
        "command": "bun test"
      },
      "status": "pending"
    }
  ]
}
```

## Inspiration

- [Geoff Huntley's Ralph](https://ghuntley.com/ralph) - The original technique
- [Effect.ts](https://effect.website) - Functional programming patterns

## Development

```bash
# Run in dev mode
bun run dev

# Type check
bun run typecheck

# Run tests
bun test

# Build for distribution
bun run build
```

## License

MIT

---

*"The arc of iteration bends toward working code."* ⚡
