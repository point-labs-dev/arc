/**
 * Agent Types
 * 
 * Agent-agnostic types for the execution layer.
 * Supports: Codex, Claude Code, OpenCode, Pi
 */

import { Data } from "effect"

// === Supported Agents ===

export type AgentType = "codex" | "claude-code" | "opencode" | "pi"

export const AGENT_TYPES: AgentType[] = ["codex", "claude-code", "opencode", "pi"]

export const isValidAgent = (agent: string): agent is AgentType =>
  AGENT_TYPES.includes(agent as AgentType)

// === Agent Config ===

export interface AgentConfig {
  /** Which agent to use */
  agent: AgentType
  /** Working directory */
  cwd: string
  /** Auto-approve changes (--yolo, --full-auto, etc.) */
  autoApprove?: boolean
  /** Timeout in milliseconds */
  timeout?: number
  /** Provider (for Pi) */
  provider?: string
  /** Model (for Pi) */
  model?: string
}

// === Execution Result ===

export interface AgentExecutionResult {
  /** Whether the agent ran successfully (doesn't mean task succeeded) */
  success: boolean
  /** Combined stdout output */
  output: string
  /** Exit code from the process */
  exitCode: number
  /** Error message if failed */
  error?: string
  /** Duration in milliseconds */
  durationMs: number
}

// === Session State ===

export interface AgentSession {
  /** Unique session ID */
  id: string
  /** Agent type */
  agent: AgentType
  /** Process PID */
  pid: number
  /** Working directory */
  cwd: string
  /** Start time */
  startedAt: Date
  /** Whether still running */
  running: boolean
  /** Output buffer */
  output: string[]
  /** Exit code (if finished) */
  exitCode?: number
}

// === Errors ===

export class AgentSpawnError extends Data.TaggedError("AgentSpawnError")<{
  readonly message: string
  readonly agent: AgentType
  readonly code?: number
}> {}

export class AgentTimeoutError extends Data.TaggedError("AgentTimeoutError")<{
  readonly message: string
  readonly agent: AgentType
  readonly timeout: number
}> {}

export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly message: string
  readonly agent: AgentType
}> {}

// === Agent Metadata ===

export interface AgentInfo {
  name: string
  binary: string
  description: string
  flags: {
    autoApprove?: string
    prompt?: string
  }
}

export const AGENTS: Record<AgentType, AgentInfo> = {
  codex: {
    name: "Codex CLI",
    binary: "codex",
    description: "OpenAI's coding agent (gpt-5.2-codex)",
    flags: {
      autoApprove: "--yolo", // or --full-auto for sandboxed
      prompt: "exec",
    },
  },
  "claude-code": {
    name: "Claude Code",
    binary: "claude",
    description: "Anthropic's Claude coding assistant",
    flags: {
      prompt: "", // Just pass prompt directly
    },
  },
  opencode: {
    name: "OpenCode",
    binary: "opencode",
    description: "Open-source coding agent",
    flags: {
      prompt: "run",
    },
  },
  pi: {
    name: "Pi Coding Agent",
    binary: "pi",
    description: "Mario Zechner's coding agent (multi-provider)",
    flags: {
      prompt: "-p",
    },
  },
}
