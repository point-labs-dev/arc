# Arc — Software Factory

## What This Is

Arc is a software factory built on the Attractor specification (https://github.com/strongdm/attractor). It orchestrates AI coding agents through DOT-based pipelines to autonomously implement software from specifications.

## Core Principle

**SPEC → Verify. Not task lists.**

- Humans write specifications (what the system should do) and verification (how to prove it works)
- The agent reads the spec and decides what to implement and in what order
- Each coding attempt uses a FRESH context window — no accumulated confusion
- Learnings from failed attempts persist on disk (`progress/` directory)
- Agent keeps trying until verification passes (convergence, not completion)
- Holdout scenarios stored outside codebase — agent can't see them, can't cheat

## Architecture

```
arc/
├── src/
│   ├── engine/       # DOT pipeline runner (Attractor spec implementation)
│   ├── backends/     # Pi RPC as CodergenBackend
│   └── cli/          # CLI interface
├── packages/
│   └── ui/           # Monitoring web dashboard (Vite + React)
├── reference/        # Original Attractor NLSpecs (read-only reference)
├── SPEC.md           # What Arc should do
├── PROJECT.md        # Vision and architecture
├── scenarios/        # Holdout tests for Arc itself
└── progress/         # Learnings from build attempts
```

## Build Order

1. **src/engine** — The Attractor pipeline engine. This is the foundation.
   - Read `reference/attractor-spec.md` thoroughly
2. **src/backends** — Pi RPC integration as the CodergenBackend
3. **src/cli** — CLI wrapper (`arc run`, `arc status`)
4. **packages/ui** — Monitoring dashboard (see `specs/monitoring-ui.md`)

## Key Reference Files

- `reference/attractor-spec.md` — The pipeline engine specification (2083 lines)
- `reference/coding-agent-loop-spec.md` — The coding agent loop spec (Pi implements this)
- `reference/unified-llm-spec.md` — The unified LLM client spec (Pi implements this)
- `specs/monitoring-ui.md` — The monitoring web UI specification
- `SPEC.md` — What Arc should do (functional spec)
- `PROJECT.md` — Vision, architecture, design decisions
