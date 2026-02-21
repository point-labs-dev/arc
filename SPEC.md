# Arc Specification

*This is what Arc should do. Not how to build it. Not in what order.*
*The implementing agent reads this spec and decides its own approach.*

---

## 1. Convergence Loop

Arc reads a project's `SPEC.md` and drives an autonomous agent to implement it. The agent works in a loop until the spec is satisfied.

**Behavior:**

- Arc reads the project spec and any existing progress from `progress/`
- Arc spawns a **fresh** Pi session via RPC (`pi --mode rpc`) — clean context window every attempt
- The Pi session receives: the spec, relevant learnings from past attempts, current project state (git diff, file tree). It does NOT receive holdout scenarios.
- Pi implements what it determines is the next most important thing
- When Pi finishes (or hits a timeout), Arc runs verification
- On verification pass: Arc commits the changes and updates progress
- On verification fail: Arc writes learnings to `progress/attempt-NNN.md` (what was tried, what failed, error output) and spawns a NEW fresh Pi session with these learnings
- Arc continues until the full spec is satisfied or a circuit breaker fires (configurable max attempts)

**Verification has three layers:**

1. **Standard** — run project's test/lint/typecheck commands (boolean pass/fail)
2. **Holdout scenarios** — run scenario files from `scenarios/` that the agent never saw (boolean pass/fail per scenario)
3. **Satisfaction** — LLM evaluates "does this implementation satisfy the spec?" (probabilistic score, 0-1)

All three must pass for a commit. Satisfaction threshold is configurable (default 0.8).

**Fresh context is mandatory.** Each attempt gets a new Pi session. No conversation history carries over. The ONLY continuity between attempts is:
- The files on disk (git repo state)
- The `progress/` directory (learnings from past attempts)
- The spec itself

---

## 2. Spec Format

A project spec is a markdown file (`SPEC.md`) that describes what the system should do.

**A spec contains:**
- What the system does (functional requirements)
- Acceptance criteria for each requirement
- Constraints (technology, performance, security)
- What it does NOT do (scope boundaries)

**A spec does NOT contain:**
- Implementation steps or task ordering
- File/function names to create
- Specific libraries to use (unless it's a hard constraint)

The agent reads the spec and decides how to implement it. The spec is the destination, not the directions.

---

## 3. Holdout Scenarios

Scenarios are end-to-end user stories stored in `scenarios/` that the agent never sees during implementation.

**Scenario format:**
```markdown
# Scenario: User logs in with valid credentials

## Setup
- Database has user "test@example.com" with password "hashed_correctly"
- Server is running on port 3000

## Steps
1. POST /api/auth/login with {"email": "test@example.com", "password": "correct"}
2. Response should be 200 with a JWT token in the body
3. GET /api/me with the JWT token in Authorization header
4. Response should be 200 with user profile data

## Expected
- Login succeeds
- Token is valid JWT
- Profile returns correct email
- No server errors in logs
```

**Key properties:**
- Stored outside the codebase or in a directory the agent is instructed to ignore
- Arc runs them AFTER the agent says it's done
- Agent cannot optimize for specific scenarios (anti-cheating)
- Scenarios can be evaluated by LLM for satisfaction (not just boolean assertions)

---

## 4. Progress Persistence

Failed attempts write learnings to disk so future attempts benefit without polluting context.

**Per-attempt file (`progress/attempt-NNN.md`):**
```markdown
# Attempt 3 — 2026-02-21T14:30:00Z

## What was attempted
Implemented the auth endpoint with JWT token generation.

## What worked
- Express route created correctly
- JWT signing works

## What failed
- Verification: typecheck failed — `jsonwebtoken` types not installed
- Holdout: login scenario failed — password comparison uses == not bcrypt

## Files changed
- src/routes/auth.ts (new)
- src/middleware/auth.ts (new)
- package.json (updated)

## Key learning
Need to install @types/jsonwebtoken AND use bcrypt for password comparison.
```

**Progress state (`progress/state.json`):**
```json
{
  "totalAttempts": 3,
  "specItemsCompleted": ["auth-endpoint", "user-model"],
  "specItemsPending": ["profile-endpoint", "error-handling"],
  "lastAttemptAt": "2026-02-21T14:30:00Z",
  "overallSatisfaction": 0.6
}
```

---

## 5. Pi RPC Integration

Arc communicates with Pi via JSON-over-stdin/stdout (RPC mode).

**Spawning:**
```bash
pi --mode rpc --provider anthropic --model claude-sonnet-4-20250514 --no-session
```

**Sending a task:**
```json
{"type": "prompt", "message": "<spec + learnings + project context>"}
```

**Receiving events (stdout, one JSON per line):**
- `tool_execution_start` / `tool_execution_end` — what the agent is doing
- `text_delta` — agent's text output
- `message_end` — agent finished this turn

**Steering on failure:**
```json
{"type": "steer", "message": "Verification failed: <error details>"}
```

**Aborting:**
```json
{"type": "abort"}
```

Each attempt spawns a NEW `pi --mode rpc` process. Previous process is terminated. Fresh context.

---

## 6. Monitoring Web UI

A web dashboard showing everything Arc does, in real-time and historically.

**Live mode:**
- Real-time event feed from active Pi sessions (tool calls, file edits, bash commands)
- Inline diffs (syntax highlighted, unified/side-by-side)
- Context window usage visualization
- Token count and dollar cost
- Multi-session view for parallel convergence
- Alert bar (sensitive file access, token spikes, cost threshold)

**Replay mode:**
- Browse past sessions by project, date, outcome
- Full execution trace reconstruction (every tool call, every diff)
- Token and cost breakdown per session
- Learnings timeline

**Architecture view:**
- Render Mermaid/DOT diagrams from the project
- Live sync — agent edits diagram, human sees update, and vice versa
- Visual representation of the convergence pipeline

**Analytics:**
- Cost over time by project
- Success rate trends
- Token efficiency (improving over time?)
- Common failure patterns

---

## 7. Human-in-the-Loop

Arc can pause and ask for human input at designated points.

**Approval gates:**
- After verification passes, optionally pause for human approval before committing
- Post to Discord: "Here's what changed. ✅ to approve, ❌ to reject with feedback"
- Configurable per-project: `approval: required | optional | none`

**Mid-execution steering:**
- Human sends message to #arc in Discord
- Arc forwards to active Pi session as a steer command
- Pi adjusts its approach based on human input

**Checkpoint notifications:**
- Arc posts progress updates at configurable intervals
- "Attempt 3: auth endpoint working, profile endpoint failing on validation"

---

## 8. Parallel Convergence

Multiple spec items can converge simultaneously when they're independent.

**Isolation:**
- Each parallel attempt gets its own git worktree
- Each gets its own fresh Pi session
- No shared state between parallel sessions (only shared spec + learnings)

**Merge:**
- When parallel items pass verification individually, merge worktrees
- Run full verification on the merged result
- If merge conflicts: report to human, don't auto-resolve

---

## 9. Configuration

Per-project config in `arc.config.yaml`:

```yaml
# What to verify
verification:
  commands:
    - "npm run typecheck"
    - "npm run test"
    - "npm run lint"
  timeout: 120  # seconds per command

# Convergence settings
convergence:
  maxAttempts: 10           # circuit breaker
  satisfactionThreshold: 0.8
  freshContextPerAttempt: true  # always true, here for documentation

# Model preferences
model:
  default: "claude-sonnet-4-20250514"
  planning: "claude-opus-4-0-20250514"  # for spec analysis
  satisfaction: "claude-opus-4-0-20250514"  # for judging satisfaction

# Human gates
approval: optional  # required | optional | none

# Parallel
parallel:
  maxSessions: 3
  useWorktrees: true

# Monitoring
monitoring:
  discordChannel: "#arc"
  progressInterval: 300  # seconds between progress updates
```

---

## 10. Event System

Every action Arc takes emits a typed event. Events are the single source of truth consumed by:
- Monitoring Web UI (live + replay)
- Discord notifications
- SQLite persistence (for replay and analytics)
- Logs

**Event types:**
- `spec_read` — Arc read the project spec
- `attempt_start` — new fresh Pi session spawned
- `attempt_end` — Pi session completed (with result)
- `file_read` / `file_edit` — agent touched a file (with diff)
- `tool_call` — agent used a tool (with args and result)
- `bash_exec` — agent ran a command (with output)
- `verification_start` / `verification_end` — running verification
- `holdout_start` / `holdout_end` — running holdout scenarios
- `satisfaction_score` — LLM satisfaction evaluation result
- `learning_persisted` — learnings written to disk
- `commit` — changes committed
- `human_gate` — waiting for human input
- `alert` — something noteworthy (sensitive file, token spike)
