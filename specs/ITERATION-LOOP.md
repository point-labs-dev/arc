# Iteration Loop Specification

## Overview

Arc implements a rapid iteration development loop. Unlike traditional planning-first approaches, Arc emphasizes small, verified increments with continuous learning.

## Philosophy

> "Plan a little, build a little, learn, repeat."

- No big upfront planning
- Plan just the next piece
- Build, verify, learn
- Adapt plan based on outcomes
- Track progress across iterations

## Loop Structure

```
┌─────────────────────────────────────────┐
│              IDEA / GOAL                │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│         PLAN NEXT PIECE                 │
│   (just enough to start, not everything)│
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│              BUILD                      │
│         (Ralph loop until ✓)            │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│         VERIFY / OBSERVE                │
│      What worked? What didn't?          │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│         UPDATE PLAN                     │
│   Add learnings, adjust next steps      │
└─────────────────┬───────────────────────┘
                  │
                  ▼
            Done? ──No──► (back to PLAN NEXT PIECE)
                  │
                 Yes
                  ▼
               SHIP IT
```

## Ralph Loop (Inner Loop)

The Ralph loop handles task execution with automatic retry:

```
Pick Task → Build → Verify → Pass? Done : Retry with context
```

### Verification Modes

1. **With acceptance criteria**: Auto-verify by running command
2. **Without acceptance criteria**: Requires manual verification

### Circuit Breakers

- Max attempts per task (default: 5)
- No-change detection (stops if no files change)
- Timeout per attempt

### Context Building

Each retry includes:
- Previous attempt output
- Error messages
- Files changed
- Learnings from failures

## Commands

| Command | Description |
|---------|-------------|
| `arc iterate` | Run one iteration |
| `arc go` | Keep iterating until done/blocked |

## Configuration

```typescript
interface IterateConfig {
  maxAttempts: number       // Max retries per task
  agent: AgentConfig        // Which coding agent to use
  cwd: string              // Working directory
}
```

## Events

The loop emits events for UI/logging:

- `picking_task` - Selecting next task
- `building` - Executing task
- `verifying` - Running verification
- `recording` - Recording outcome
- `updating_plan` - Updating project state
- `complete` - Task completed
- `failed` - Task failed

## Related Specs

- [PROJECT-MODEL](./PROJECT-MODEL.md) - Data structures
- [VERIFICATION](./VERIFICATION.md) - Verification system
- [AGENT-ABSTRACTION](./AGENT-ABSTRACTION.md) - Execution layer
