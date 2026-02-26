# Arc — Software Factory

## Vision

A **software factory** powered by DOT-based pipelines. The convergence loop — spec → implement → verify → learn → retry — is expressed as a graph, not code. The engine walks the graph. Pi writes the code.

**Core principles:**
- **The graph is the program** — convergence flow lives in `pipelines/convergence.dot`
- **Spec, not tasks** — describe WHAT the system should do, not HOW
- **Verify, not review** — holdout scenarios prove correctness without human eyes on code
- **Fresh context per attempt** — no accumulated confusion
- **Learnings on disk** — `progress/` directory persists across context resets

**Inspiration:**
- StrongDM's Software Factory (https://factory.strongdm.ai)
- Attractor (https://github.com/strongdm/attractor)
- Geoff Huntley's Ralph first principles

## Architecture

```
User: arc run convergence.dot --project ./my-app
  │
  ▼
CLI (thin: loads DOT, wires backends, calls runPipeline)
  │
  ▼
Engine (walks the DOT graph)
  │
  ├── ReadSpec node (Opus analyzes spec + learnings)
  ├── Implement node (Sonnet via Pi RPC — fresh process)
  ├── Test node (shell: typecheck + test + lint)
  ├── Holdout node (shell: run scenario scripts)
  ├── Satisfaction node (Opus judges: does it satisfy the spec?)
  ├── Check node (conditional: satisfaction >= 0.8?)
  │     ├── fail → PersistLearnings → back to Implement
  │     └── pass → Commit → MoreSpec?
  │                            ├── more → back to ReadSpec
  │                            └── done → Exit
  │
  ▼
Backends:
  - PiRpcBackend (CodergenBackend — spawns pi --mode rpc)
  - Interviewer (human gates — CLI stdin or Discord)
  - EventEmitter (NDJSON log, WebSocket to monitoring UI)
```

## Project File Structure (for projects using Arc)

```
my-project/
├── SPEC.md              # What the system should do (human-written)
├── scenarios/           # Holdout verification (human-written, agent never sees)
├── progress/            # Learnings from attempts (Arc-written)
│   ├── attempt-001.md
│   ├── state.json
│   └── events.ndjson
├── arc.config.yaml      # Configuration (optional)
└── src/                 # Code the agent writes
```

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Flow definition | DOT pipeline graph | Visual, renderable, version-controllable. The graph IS the program. |
| Task list vs Spec | Spec-driven | Agent picks order based on dependencies/complexity |
| Context management | Fresh per attempt | Prevents accumulated confusion |
| Learning persistence | Files on disk | Survives context resets |
| Verification | Standard + Holdout + Satisfaction | Three layers: boolean, anti-cheat, probabilistic |
| Coding backend | Pi RPC | Structured JSON events, fresh process per attempt |
| Runtime | TypeScript + Effect.ts | Typed errors, structured concurrency, DI |
