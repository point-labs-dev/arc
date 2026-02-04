# CLI Commands Specification

## Overview

Arc provides a command-line interface for rapid iteration product development.

## Commands

### `arc init`

Initialize a new project.

```bash
arc init "<goal>"
```

**Arguments:**
- `goal` (required): The project goal/vision

**Options:**
- `--project <file>`: Custom project file name

**Example:**
```bash
arc init "Build a REST API for a todo application"
```

**Output:**
- Creates `arc-project.json` in current directory
- Displays project info and next steps

---

### `arc add`

Add a task to the backlog.

```bash
arc add "<task>" [options]
```

**Arguments:**
- `task` (required): Task description

**Options:**
- `--verify "<cmd>"`: Verification command (enables auto-verify)
- `--why "<reason>"`: Why this task matters
- `--size <s|m|l>`: Task size estimate
- `--top`: Add to top of backlog

**Examples:**
```bash
# With verification (recommended)
arc add "Build health endpoint" --verify "curl -s localhost:3000/health"

# With context
arc add "Add authentication" --why "Required for user features" --size medium

# Priority task
arc add "Fix critical bug" --top
```

---

### `arc iterate`

Run one iteration (pick task, build, verify, learn).

```bash
arc iterate [options]
```

**Options:**
- `--agent <name>`: Coding agent (codex, claude-code, opencode, pi)
- `--max-attempts <n>`: Max retries per task (default: 5)
- `--provider <name>`: LLM provider (Pi only)
- `--model <id>`: Model ID (Pi only)
- `--auto-approve`: Auto-approve changes

**Example:**
```bash
arc iterate --agent claude-code --max-attempts 3
```

---

### `arc go`

Keep iterating until all tasks done or blocked.

```bash
arc go [options]
```

**Options:**
Same as `arc iterate`, plus:
- `--stop-on-failure`: Stop if any task fails

**Example:**
```bash
arc go --agent codex --auto-approve
```

---

### `arc status`

Show project status and progress.

```bash
arc status
```

**Output:**
- Project name and goal
- Progress bar
- Statistics (iterations, completed, blocked)
- Next task
- Recent activity

---

### `arc backlog`

Show the task backlog.

```bash
arc backlog
```

**Output:**
- Numbered list of tasks
- Status icons (⏳ pending, 🔄 in progress, 🚫 blocked)
- Size labels
- Acceptance criteria

---

### `arc insights`

Show learnings and insights.

```bash
arc insights
```

**Output:**
- Insights grouped by tag
- Source task references
- Timestamps

---

## Global Options

Available for all commands:

| Option | Description |
|--------|-------------|
| `--project <file>` | Custom project file (default: arc-project.json) |
| `--help` | Show help |

## Agent Options

Available for `iterate` and `go`:

| Option | Description |
|--------|-------------|
| `--agent <name>` | Coding agent to use |
| `--max-attempts <n>` | Max retries per task |
| `--provider <name>` | LLM provider (Pi only) |
| `--model <id>` | Model ID (Pi only) |
| `--auto-approve` | Auto-approve changes |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (see message) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For Claude Code |
| `OPENAI_API_KEY` | For Codex |

## Legacy Commands

These commands exist for backward compatibility:

- `arc plan` - Planning UI (Phase 1)
- `arc run <plan.json>` - Execute static plan (Phase 1)

## Related Specs

- [CLI-OUTPUT](./CLI-OUTPUT.md) - Output formatting
- [ITERATION-LOOP](./ITERATION-LOOP.md) - Loop mechanics
