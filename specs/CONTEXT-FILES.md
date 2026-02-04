# Context Files Specification

## Overview

Arc loads project context from markdown files to give the coding agent understanding of the project.

## Supported Files

| File | Description | Convention |
|------|-------------|------------|
| `AGENTS.md` | OpenClaw convention | Primary |
| `CLAUDE.md` | Claude Code convention | Secondary |

## Loading Behavior

1. Check for `AGENTS.md` in working directory
2. If not found, check for `CLAUDE.md`
3. If either exists, load content as project context
4. Content is prepended to every task prompt

## Symlink Auto-Creation

Following OpenClaw's convention, Arc auto-creates symlinks:

```
If AGENTS.md exists and CLAUDE.md doesn't:
  → Create symlink: CLAUDE.md → AGENTS.md

If CLAUDE.md exists and AGENTS.md doesn't:
  → Create symlink: AGENTS.md → CLAUDE.md
```

This ensures both naming conventions work regardless of which file the user created.

## Context Injection

When building a task prompt:

```typescript
const loadAgentContext = (cwd: string): string | null => {
  ensureContextSymlinks(cwd)  // Create missing symlinks
  
  const agentsMdPath = path.join(cwd, "AGENTS.md")
  const claudeMdPath = path.join(cwd, "CLAUDE.md")
  
  if (fs.existsSync(agentsMdPath)) {
    return fs.readFileSync(agentsMdPath, "utf-8")
  }
  
  if (fs.existsSync(claudeMdPath)) {
    return fs.readFileSync(claudeMdPath, "utf-8")
  }
  
  return null
}
```

## Prompt Structure

When context is available:

```
# Project Context

<contents of AGENTS.md or CLAUDE.md>

---

# Task

<task description>

## Why This Matters
<why field if present>

## Acceptance Criteria
<verification command if present>

## Instructions
Complete this task...
```

## File Contents Recommendations

A good context file includes:

1. **Project overview** - What is being built
2. **Tech stack** - Languages, frameworks, tools
3. **Code conventions** - Style, patterns, naming
4. **Directory structure** - Where things go
5. **Build/test commands** - How to build and test

## Example Context File

```markdown
# My API Project

## Overview
REST API for todo management built with Express and TypeScript.

## Tech Stack
- Node.js 20+
- TypeScript 5.x
- Express 4.x
- PostgreSQL

## Directory Structure
src/
├── routes/      # API routes
├── models/      # Database models
├── middleware/  # Express middleware
└── utils/       # Shared utilities

## Commands
- `bun install` - Install dependencies
- `bun run dev` - Start dev server
- `bun test` - Run tests
- `bun run build` - Build for production

## Code Style
- Use async/await, not callbacks
- Prefer functional over OOP
- All exports should be typed
```

## Startup Output

When Arc loads a context file, it shows:

```
⚡ Arc - Agent-Agnostic Execution
📋 Plan: My Feature
🤖 Agent: Claude Code
📄 Context: AGENTS.md    ← shows which file was loaded
```

## Related Specs

- [PROJECT-MODEL](./PROJECT-MODEL.md) - Project structure
- [CLI-COMMANDS](./CLI-COMMANDS.md) - How context affects commands
