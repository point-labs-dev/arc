# Ralph 🍩

> "Me fail English? That's unpossible!" - Ralph Wiggum

An agentic coding orchestrator that implements [Geoff Huntley's Ralph Wiggum primitive](https://ghuntley.com/ralph) with a planning-first approach.

## Philosophy

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Ralph is a technique. In its purest form, it's a loop. The beauty of Ralph is that it's **deterministically bad in an undeterministic world**.

Each time Ralph does something wrong, you tune it—like a guitar. Eventually, Ralph learns all the signs.

## Features

- **Planning Phase** - Interactive UI to build execution plans collaboratively with AI
- **Execution Phase** - Ralph loop that runs until the plan is complete
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

### Continuous Mode (Ralph Mode)
```bash
ralph run plan.json
```
Runs the loop until the plan is complete or the circuit breaker triggers.

### Hand-Crank Mode
```bash
ralph run plan.json --crank
```
Pauses after each iteration. Options:
- `[C]ontinue` - Run next iteration
- `[R]eview` - Review changes before continuing  
- `[T]une` - Modify the prompt/context
- `[S]top` - Stop execution

## Commands

| Command | Description |
|---------|-------------|
| `ralph plan` | Start planning UI |
| `ralph plan --load plan.json` | Resume existing plan |
| `ralph run plan.json` | Execute plan (continuous) |
| `ralph run plan.json --crank` | Execute plan (hand-crank) |
| `ralph status` | Show execution status |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key |
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `RALPH_PROVIDER` | No | Default: `anthropic` |
| `RALPH_MODEL` | No | Default: `claude-sonnet-4-20250514` |

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
- [Pi Coding Agent](https://github.com/badlogic/pi-mono) - Extensible architecture
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

*"I choo-choo-choose you!"* 🚂
