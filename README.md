# Arc ⚡

> A software factory. Specifications in, working software out.

Arc is a DOT-based pipeline engine that orchestrates AI coding agents. Built on the [Attractor specification](https://github.com/strongdm/attractor) from StrongDM.

## Core Principle

**SPEC → Verify. Not task lists.**

- Humans write specs (what) and verification (how to prove it works)
- The agent decides what to build and in what order
- Each attempt uses a fresh context window — no accumulated confusion
- Learnings from failed attempts persist on disk
- Holdout scenarios the agent can't see prevent cheating
- Converge until verification passes

## Architecture

```
arc/
├── src/
│   ├── engine/        # DOT pipeline runner (Attractor-compatible)
│   ├── backends/      # Pi RPC as CodergenBackend
│   └── cli/           # CLI (arc run, arc validate, arc status)
├── packages/
│   └── ui/            # Monitoring web dashboard
├── reference/         # Original Attractor NLSpecs
├── SPEC.md            # What Arc does
└── scenarios/         # Holdout verification
```

## Stack

- **TypeScript** (strict mode, ES modules)
- **Effect.ts** — typed errors, structured concurrency, retry, DI
- **Vitest** — testing
- **oxlint** — linting
- **Biome** — formatting
- **Vite + React + Tailwind** — monitoring UI

## Inspiration

- [StrongDM Software Factory](https://factory.strongdm.ai)
- [Attractor](https://github.com/strongdm/attractor)
- [Geoff Huntley's Ralph](https://ghuntley.com/ralph)
- [claude-devtools](https://github.com/matt1398/claude-devtools) + [Sidecar](https://github.com/marcus/sidecar)

## Status

🚧 Under development

## License

MIT
