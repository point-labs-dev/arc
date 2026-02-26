# Arc ⚡

> A software factory. Specifications in, working software out.

Arc is a DOT-based pipeline engine that orchestrates AI coding agents. Built on the [Attractor specification](https://github.com/strongdm/attractor) from StrongDM.

## Core Principle

**SPEC → Verify. Not task lists.**

- The convergence loop is a DOT pipeline graph (`pipelines/convergence.dot`)
- The engine walks the graph — no imperative orchestration code
- Each coding attempt uses a fresh context window
- Learnings from failed attempts persist on disk
- Holdout scenarios the agent can't see prevent cheating

## Structure

```
arc/
├── src/
│   ├── engine/        # DOT pipeline runner (Attractor-compatible)
│   ├── backends/      # Pi RPC as CodergenBackend
│   └── cli/           # CLI entry point (thin — calls runPipeline)
├── packages/
│   └── ui/            # Monitoring web dashboard
├── pipelines/
│   └── convergence.dot  # Default convergence pipeline
├── reference/         # Original Attractor NLSpecs
├── scenarios/         # Holdout verification
└── progress/          # Attempt learnings
```

## Usage

```bash
npm install

# Run the convergence pipeline on a project
npx tsx src/cli/main.ts run --project /path/to/project

# Validate a pipeline without running
npx tsx src/cli/main.ts validate pipelines/convergence.dot

# Check progress
npx tsx src/cli/main.ts status --project /path/to/project
```

Your project needs:
- `SPEC.md` — what the system should do
- `scenarios/` — holdout tests (optional)
- `arc.config.yaml` — config (optional, has defaults)

## Stack

- **TypeScript** (strict mode, ES modules)
- **Effect.ts** — typed errors, structured concurrency
- **Vitest** — testing (98 tests passing)
- **oxlint** — linting
- **Biome** — formatting

## Inspiration

- [StrongDM Software Factory](https://factory.strongdm.ai)
- [Attractor](https://github.com/strongdm/attractor)
- [Geoff Huntley's Ralph](https://ghuntley.com/ralph)

## License

MIT
