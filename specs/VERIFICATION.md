# Verification Specification

## Overview

Verification is how the Ralph loop knows when a task is complete. Without verification, the loop cannot close automatically.

## Core Principle

> "If you can't verify it, you can't automate it."

Tasks must have acceptance criteria (verification commands) for the Ralph loop to work. Tasks without verification require manual review.

## Verification Modes

### 1. Command-Based Verification (Recommended)

```bash
arc add "Build health endpoint" --verify "curl -s localhost:3000/health"
```

The verification command is executed after each build attempt. If exit code is 0, task passes.

**Examples:**
```bash
# HTTP endpoint check
--verify "curl -s localhost:3000/health | grep ok"

# Test suite
--verify "bun test src/api.test.ts"

# File existence
--verify "test -f dist/bundle.js"

# Build check
--verify "bun run build && test -d dist"

# Lint check
--verify "bun run lint --quiet"
```

### 2. No Verification (Manual Review)

```bash
arc add "Write API documentation"
# ⚠️ No acceptance criteria - will need manual verification
```

Tasks without `--verify` are flagged for manual review. They complete after one successful build attempt but are marked as unverified.

## Verification Flow

```
Agent completes work
        │
        ▼
Has acceptance criteria?
        │
    ┌───┴───┐
    │       │
   Yes      No
    │       │
    ▼       ▼
Run command   Mark unverified
    │         Complete
    ▼
Exit 0?
    │
┌───┴───┐
│       │
Yes     No
│       │
▼       ▼
Pass   Retry with
       error context
```

## Verification Execution

```typescript
// Verification runs as shell command
execSync(task.acceptanceCriteria, {
  cwd: config.cwd,
  stdio: "pipe",
  timeout: 30000,  // 30 second timeout
})
```

### Timeout

Default verification timeout is 30 seconds. Long-running verifications should be avoided.

### Environment

Verification runs in the project's working directory with the current shell environment.

## Writing Good Verification Commands

### Do ✅

- Use exit codes (0 = success)
- Be specific about what you're checking
- Keep commands fast (<30s)
- Make commands idempotent

### Don't ❌

- Use interactive commands
- Require user input
- Rely on external services (flaky)
- Use commands that modify state

## Examples by Task Type

| Task Type | Verification Command |
|-----------|---------------------|
| API endpoint | `curl -sf localhost:3000/api/health` |
| Unit tests | `bun test src/module.test.ts` |
| Build | `bun run build && test -d dist` |
| Type check | `bun run typecheck` |
| Lint | `bun run lint --quiet` |
| File created | `test -f path/to/file.ts` |
| Content check | `grep -q "export" src/index.ts` |

## Future Enhancements

### Planned Verification Types

1. **Semantic verification** - AI judges if output meets intent
2. **Visual verification** - Screenshot comparison
3. **Integration tests** - Multi-step verification sequences
4. **Human-in-loop** - Explicit approval workflow

## Related Specs

- [ITERATION-LOOP](./ITERATION-LOOP.md) - How verification fits in the loop
- [CLI-COMMANDS](./CLI-COMMANDS.md) - `--verify` flag documentation
