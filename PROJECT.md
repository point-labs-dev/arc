# Arc — Software Factory

## Vision

A **software factory** that lives inside OpenClaw. Specifications + verification scenarios drive autonomous agents that write code and converge on correctness — without human code review.

**The model decides what to build and in what order.** Humans write specs and verification. The agent reads the spec, picks what to implement, attempts it in a fresh context window, verifies, persists learnings to disk, and retries with clean context until verification passes.

**Core principles:**
- **Spec, not tasks** — describe WHAT the system should do, not HOW to build it
- **Verify, not review** — holdout scenarios prove correctness without human eyes on code
- **Fresh context per attempt** — no accumulated confusion. Clean slate every try.
- **Learnings on disk** — failed attempts persist outside the context window so future attempts learn without carrying baggage
- **Convergence** — keep iterating until the spec is satisfied, not until a checklist is done

**Inspiration:**
- StrongDM's Software Factory (https://factory.strongdm.ai)
- Attractor (https://github.com/strongdm/attractor)
- Geoff Huntley's Ralph first principles — don't give the model a task list, give it a spec and verification
- See `memory/projects/arc-software-factory.md` for full analysis

## Architecture

Three layers:

1. **Arc Orchestrator** (OpenClaw) — reads specs, runs verification, persists learnings, manages the convergence loop
2. **Pi RPC Bridge** — spawns `pi --mode rpc` processes, sends/receives structured JSON events
3. **Pi AgentSession** — does the actual coding (LLM calls, file edits, bash)

Full technical spec: `ARCHITECTURE.md`

## The Convergence Loop

```
┌─────────────────────────────────────────────────┐
│                 Arc Orchestrator                  │
│                                                   │
│  1. Read SPEC.md                                  │
│  2. Read progress/ (learnings from past attempts) │
│  3. Agent decides what to implement next           │
│                                                   │
│  4. Spawn FRESH Pi session (clean context)         │
│     └─ Inject: spec + learnings + project state   │
│     └─ Do NOT inject: holdout scenarios            │
│                                                   │
│  5. Pi implements, Arc streams events              │
│                                                   │
│  6. Verify:                                        │
│     a. Standard: build/lint/typecheck/test          │
│     b. Holdout: run scenarios agent never saw       │
│     c. Satisfaction: LLM judges "does this work?"   │
│                                                   │
│  7. Pass? → commit → pick next spec item            │
│     Fail? → persist learnings to progress/          │
│           → spawn NEW fresh Pi session              │
│           → retry with learnings (not old context)  │
│                                                   │
│  8. Repeat until full spec is satisfied             │
└─────────────────────────────────────────────────┘
```

## Project File Structure

```
project/
├── SPEC.md              # What the system should do (human-written)
├── scenarios/           # Holdout verification (human-written, agent never sees)
│   ├── auth-flow.scenario.md
│   ├── error-handling.scenario.md
│   └── edge-cases.scenario.md
├── progress/            # Learnings from attempts (Arc-written, agent reads)
│   ├── attempt-001.md   # "Tried X, failed because Y"
│   ├── attempt-002.md   # "Tried Z, got further, failed at W"
│   └── state.json       # Current progress: what's done, what's pending
├── arc.config.yaml      # Verification commands, model preferences, thresholds
├── src/                 # The actual codebase (agent writes this)
└── ...
```

**SPEC.md** — The specification. Describes what the system should do, acceptance criteria, constraints. NOT a task list. The agent reads this and decides its own implementation order.

**scenarios/** — Holdout test scenarios. Stored separately, never injected into agent prompts. Arc runs them post-hoc to verify the agent's work. Anti-cheating mechanism.

**progress/** — Persistent learnings. Each failed attempt writes what it tried, what worked, what failed. Next fresh session reads these to avoid repeating mistakes. This is the "disk memory" that survives context window resets.

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Task list vs Spec | Spec-driven | Agent picks order based on dependencies/complexity, not human sequencing |
| Context management | Fresh per attempt | Prevents accumulated confusion, keeps context clean |
| Learning persistence | Files on disk | Survives context resets, agent reads relevant learnings |
| Verification model | Standard + Holdout + Satisfaction | Three layers: boolean tests, anti-cheat scenarios, probabilistic LLM judging |
| PTY vs RPC | Pi RPC | Structured JSON events, not terminal scraping |
| Where it lives | OpenClaw skill | Leverages existing session/tool/Discord infrastructure |
| Pipeline format | DOT/Mermaid (visual) | Architect-friendly, renderable, version-controllable |

## Milestones

- **M1:** Convergence loop MVP — spec → fresh Pi session → verify → persist learnings → retry
- **M2:** Holdout scenario system — scenarios agent can't see, satisfaction scoring
- **M3:** Monitoring Web UI — live events + session replay + architecture diagrams
- **M4:** Pipeline visualization — DOT/Mermaid rendering of the workflow in the UI
- **M5:** Parallel convergence — multiple spec items converging simultaneously in worktrees
- **M6:** Human gates — approval checkpoints via Discord reactions
- **M7:** Digital Twin Universe — API clones for unlimited testing
