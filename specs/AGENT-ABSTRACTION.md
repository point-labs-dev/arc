# Agent Abstraction Specification

## Overview

Arc supports multiple coding agents through an abstraction layer. This allows users to choose their preferred agent while maintaining a consistent execution model.

## Supported Agents

| Agent | Binary | Description | Default |
|-------|--------|-------------|---------|
| `claude-code` | `claude` | Anthropic Claude Code | ✓ |
| `codex` | `codex` | OpenAI Codex CLI | |
| `opencode` | `opencode` | Open-source coding agent | |
| `pi` | `pi` | Pi Coding Agent (multi-provider) | |

## Agent Configuration

```typescript
interface AgentConfig {
  agent: AgentType           // Which agent to use
  cwd: string               // Working directory
  autoApprove?: boolean     // Auto-approve changes (--yolo)
  timeout?: number          // Execution timeout (ms)
  provider?: string         // LLM provider (Pi only)
  model?: string            // Model ID (Pi only)
}

type AgentType = "codex" | "claude-code" | "opencode" | "pi"
```

## Command Building

Each agent has a different CLI interface:

```typescript
// Codex
codex exec --yolo "prompt"

// Claude Code
claude "prompt"

// OpenCode
opencode run "prompt"

// Pi
pi -p "prompt" --provider openai --model gpt-4
```

## Execution Model

Arc uses PTY (pseudo-terminal) spawning for proper terminal emulation:

```typescript
const proc = pty.spawn(binary, args, {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  cwd: config.cwd,
  env: process.env,
})
```

### Why PTY?

- Coding agents are interactive terminal applications
- PTY provides proper escape sequence handling
- Colors and formatting work correctly
- Matches how users run these tools manually

## Agent Lifecycle

```
1. Build command for agent type
2. Spawn process with PTY
3. Stream output to UI
4. Wait for completion
5. Capture exit code
6. Return result
```

## Result Format

```typescript
interface AgentExecutionResult {
  success: boolean          // Exit code was 0
  output: string           // Combined stdout
  exitCode: number         // Process exit code
  error?: string           // Error message if failed
  durationMs: number       // How long it took
}
```

## Agent Detection

Arc checks if agents are installed:

```typescript
const binaryPath = which(agentInfo.binary)
if (!binaryPath) {
  throw new AgentNotFoundError(...)
}
```

## Auto-Approve Mode

For unattended operation, agents can auto-approve changes:

| Agent | Flag | Description |
|-------|------|-------------|
| Codex | `--yolo` | No sandbox, no approvals |
| Codex | `--full-auto` | Sandboxed, auto-approve |
| Claude Code | (none) | Uses default behavior |
| Pi | (none) | Uses default behavior |

Enable with `--auto-approve` or `--yolo`:

```bash
arc iterate --auto-approve
```

## Adding New Agents

To add a new agent:

1. Add to `AgentType` union
2. Add metadata to `AGENTS` record
3. Implement command building in `buildCommand()`
4. Test with `arc iterate --agent <new-agent>`

```typescript
// In types.ts
export const AGENTS: Record<AgentType, AgentInfo> = {
  // ... existing agents
  "new-agent": {
    name: "New Agent",
    binary: "newagent",
    description: "Description here",
    flags: {
      prompt: "--prompt",
    },
  },
}
```

## Related Specs

- [AGENT-CODEX](./AGENT-CODEX.md) - Codex-specific details
- [AGENT-CLAUDE-CODE](./AGENT-CLAUDE-CODE.md) - Claude Code details
- [AGENT-PI](./AGENT-PI.md) - Pi details
- [ITERATION-LOOP](./ITERATION-LOOP.md) - How agents are used
