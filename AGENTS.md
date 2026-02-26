# Arc — Software Factory

## What This Is

Arc is a software factory built on the [Attractor specification](https://github.com/strongdm/attractor). It orchestrates AI coding agents through DOT-based pipelines. The convergence loop is a graph, not code.

## Core Principle

**SPEC → Verify. Not task lists.**

- The convergence flow is defined in `pipelines/convergence.dot`
- The engine walks the graph: parse DOT → execute nodes → select edges → repeat
- Each coding attempt uses a FRESH context window
- Learnings persist on disk (`progress/` directory)
- Holdout scenarios stored outside codebase — agent can't cheat

## Structure

```
arc/
├── src/
│   ├── engine/          # DOT pipeline runner (Attractor spec)
│   │   ├── parser.ts    # DOT parser (BNF grammar)
│   │   ├── engine/      # Execution loop, edge selection, retry, checkpoint
│   │   ├── handlers/    # Node handlers (codergen, tool, parallel, etc.)
│   │   ├── context/     # Pipeline context, outcomes, conditions
│   │   ├── events/      # Typed event system
│   │   └── validation.ts
│   ├── backends/
│   │   └── pi-rpc.ts    # Pi RPC as CodergenBackend
│   └── cli/
│       ├── main.ts      # Entry point
│       └── index.ts     # Loads DOT, wires backends, calls runPipeline()
├── packages/
│   └── ui/              # Monitoring web dashboard (Vite + React)
├── pipelines/
│   └── convergence.dot  # Default convergence pipeline
├── reference/           # Original Attractor NLSpecs (read-only)
├── specs/
│   └── monitoring-ui.md # Web UI specification
└── progress/            # Build attempt learnings
```

## How It Works

```bash
arc run [pipeline.dot] --project /path/to/project
```

1. CLI reads the DOT file (default: `pipelines/convergence.dot`)
2. Populates context variables: `$spec`, `$learnings`, `$project_state`
3. Calls `runPipeline(graph, config)` from the engine
4. Engine walks the graph, dispatching to handlers:
   - `codergen` nodes → PiRpcBackend (spawns `pi --mode rpc`)
   - `tool` nodes → shell commands
   - `conditional` nodes → edge selection based on conditions
   - `wait.human` nodes → Interviewer interface
5. Checkpoint saved after each node (resume on crash)
6. Events emitted for monitoring UI

## Key Files

- `pipelines/convergence.dot` — THE convergence loop (this is the program)
- `src/engine/engine/engine.ts` — `runPipeline()` core loop
- `src/engine/parser.ts` — DOT parser
- `src/backends/pi-rpc.ts` — Pi RPC backend
- `reference/attractor-spec.md` — The source spec (2083 lines)

## Code Style

- TypeScript strict mode, ES modules
- Effect.ts for typed errors and concurrency where used
- Vitest for testing
- oxlint for linting, Biome for formatting
- `npm run check` validates everything
