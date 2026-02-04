/**
 * Agent Spawner
 * 
 * Agent-agnostic process spawning with PTY support.
 * Works with: Codex, Claude Code, OpenCode, Pi
 * 
 * Uses the OpenClaw execution model:
 * - PTY for proper terminal emulation
 * - Background mode for async execution
 * - Output streaming
 */

import { spawn } from "child_process"
import { Effect, Stream } from "effect"
import * as pty from "node-pty"
import { which } from "bun"
import {
  type AgentType,
  type AgentConfig,
  type AgentExecutionResult,
  type AgentSession,
  AGENTS,
  AgentSpawnError,
  AgentTimeoutError,
  AgentNotFoundError,
} from "./types"

// === Session Registry ===

const sessions = new Map<string, AgentSession>()
let sessionCounter = 0

const generateSessionId = (): string => {
  return `arc-${++sessionCounter}-${Date.now().toString(36)}`
}

// === Command Building ===

/**
 * Build the command array for a given agent and prompt.
 */
export const buildCommand = (
  prompt: string,
  config: AgentConfig
): { binary: string; args: string[] } => {
  const agentInfo = AGENTS[config.agent]
  const args: string[] = []

  switch (config.agent) {
    case "codex": {
      // codex exec [--yolo|--full-auto] "prompt"
      args.push("exec")
      if (config.autoApprove) {
        args.push("--yolo")
      } else {
        args.push("--full-auto")
      }
      args.push(prompt)
      break
    }

    case "claude-code": {
      // claude "prompt"
      args.push(prompt)
      break
    }

    case "opencode": {
      // opencode run "prompt"
      args.push("run")
      args.push(prompt)
      break
    }

    case "pi": {
      // pi [-p "prompt"] [--provider X] [--model Y]
      args.push("-p", prompt)
      if (config.provider) {
        args.push("--provider", config.provider)
      }
      if (config.model) {
        args.push("--model", config.model)
      }
      break
    }
  }

  return { binary: agentInfo.binary, args }
}

// === Agent Availability Check ===

/**
 * Check if an agent binary is available on the system.
 */
export const checkAgentAvailable = (
  agent: AgentType
): Effect.Effect<string, AgentNotFoundError> =>
  Effect.gen(function* () {
    const agentInfo = AGENTS[agent]
    const binaryPath = which(agentInfo.binary)

    if (!binaryPath) {
      return yield* Effect.fail(
        new AgentNotFoundError({
          message: `Agent binary '${agentInfo.binary}' not found. Install it first.`,
          agent,
        })
      )
    }

    return binaryPath
  })

// === Simple Execution (wait for completion) ===

/**
 * Run an agent and wait for completion.
 * 
 * @param prompt - The prompt to send to the agent
 * @param config - Agent configuration
 * @param onOutput - Optional callback for streaming output
 */
export const runAgent = (
  prompt: string,
  config: AgentConfig,
  onOutput?: (text: string) => void
): Effect.Effect<AgentExecutionResult, AgentSpawnError | AgentTimeoutError | AgentNotFoundError> =>
  Effect.gen(function* () {
    // Check agent is available
    yield* checkAgentAvailable(config.agent)

    const { binary, args } = buildCommand(prompt, config)
    const timeout = config.timeout ?? 300000 // 5 min default
    const startTime = Date.now()

    let output = ""
    let exitCode = 0
    let error: string | undefined

    yield* Effect.async<void, AgentSpawnError | AgentTimeoutError>((resume) => {
      let killed = false
      let timeoutId: NodeJS.Timeout | null = null

      // Use node-pty for proper terminal emulation
      let proc: pty.IPty
      try {
        proc = pty.spawn(binary, args, {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd: config.cwd,
          env: process.env as Record<string, string>,
        })
      } catch (err) {
        resume(
          Effect.fail(
            new AgentSpawnError({
              message: `Failed to spawn ${binary}: ${err instanceof Error ? err.message : "Unknown"}`,
              agent: config.agent,
            })
          )
        )
        return
      }

      // Handle output
      proc.onData((data) => {
        output += data
        onOutput?.(data)
      })

      // Handle exit
      proc.onExit(({ exitCode: code }) => {
        if (timeoutId) clearTimeout(timeoutId)
        if (killed) return

        exitCode = code
        resume(Effect.succeed(undefined))
      })

      // Set timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          killed = true
          proc.kill()
          resume(
            Effect.fail(
              new AgentTimeoutError({
                message: `${config.agent} timed out after ${timeout}ms`,
                agent: config.agent,
                timeout,
              })
            )
          )
        }, timeout)
      }

      // Return cleanup function
      return Effect.sync(() => {
        killed = true
        if (timeoutId) clearTimeout(timeoutId)
        try {
          proc.kill()
        } catch {
          // Ignore
        }
      })
    })

    return {
      success: exitCode === 0,
      output,
      exitCode,
      error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
      durationMs: Date.now() - startTime,
    }
  })

// === Streaming Execution ===

/**
 * Run an agent and stream output as it arrives.
 */
export const streamAgent = (
  prompt: string,
  config: AgentConfig
): Stream.Stream<string, AgentSpawnError | AgentTimeoutError | AgentNotFoundError> =>
  Stream.async((emit) => {
    const { binary, args } = buildCommand(prompt, config)
    const timeout = config.timeout ?? 300000

    let killed = false
    let timeoutId: NodeJS.Timeout | null = null

    // Check binary exists first
    const binaryPath = which(binary)
    if (!binaryPath) {
      emit.fail(
        new AgentNotFoundError({
          message: `Agent binary '${binary}' not found`,
          agent: config.agent,
        })
      )
      return Effect.void
    }

    let proc: pty.IPty
    try {
      proc = pty.spawn(binary, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: config.cwd,
        env: process.env as Record<string, string>,
      })
    } catch (err) {
      emit.fail(
        new AgentSpawnError({
          message: `Failed to spawn ${binary}: ${err instanceof Error ? err.message : "Unknown"}`,
          agent: config.agent,
        })
      )
      return Effect.void
    }

    proc.onData((data) => {
      emit.single(data)
    })

    proc.onExit(({ exitCode }) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (killed) return

      if (exitCode === 0) {
        emit.end()
      } else {
        emit.fail(
          new AgentSpawnError({
            message: `${config.agent} exited with code ${exitCode}`,
            agent: config.agent,
            code: exitCode,
          })
        )
      }
    })

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true
        proc.kill()
        emit.fail(
          new AgentTimeoutError({
            message: `${config.agent} timed out after ${timeout}ms`,
            agent: config.agent,
            timeout,
          })
        )
      }, timeout)
    }

    return Effect.sync(() => {
      killed = true
      if (timeoutId) clearTimeout(timeoutId)
      try {
        proc.kill()
      } catch {
        // Ignore
      }
    })
  })

// === Background Execution (Session-based) ===

/**
 * Start an agent in the background, returning a session for monitoring.
 */
export const spawnAgentBackground = (
  prompt: string,
  config: AgentConfig
): Effect.Effect<AgentSession, AgentSpawnError | AgentNotFoundError> =>
  Effect.gen(function* () {
    yield* checkAgentAvailable(config.agent)

    const { binary, args } = buildCommand(prompt, config)
    const sessionId = generateSessionId()

    let proc: pty.IPty
    try {
      proc = pty.spawn(binary, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: config.cwd,
        env: process.env as Record<string, string>,
      })
    } catch (err) {
      return yield* Effect.fail(
        new AgentSpawnError({
          message: `Failed to spawn ${binary}: ${err instanceof Error ? err.message : "Unknown"}`,
          agent: config.agent,
        })
      )
    }

    const session: AgentSession = {
      id: sessionId,
      agent: config.agent,
      pid: proc.pid,
      cwd: config.cwd,
      startedAt: new Date(),
      running: true,
      output: [],
    }

    // Collect output
    proc.onData((data) => {
      session.output.push(data)
    })

    // Handle exit
    proc.onExit(({ exitCode }) => {
      session.running = false
      session.exitCode = exitCode
    })

    sessions.set(sessionId, session)
    return session
  })

/**
 * Get a session by ID.
 */
export const getSession = (sessionId: string): AgentSession | undefined =>
  sessions.get(sessionId)

/**
 * Get all active sessions.
 */
export const listSessions = (): AgentSession[] =>
  Array.from(sessions.values())

/**
 * Get session output.
 */
export const getSessionOutput = (
  sessionId: string,
  offset = 0,
  limit?: number
): string[] => {
  const session = sessions.get(sessionId)
  if (!session) return []
  
  const output = session.output.slice(offset)
  return limit ? output.slice(0, limit) : output
}

/**
 * Check if session is still running.
 */
export const isSessionRunning = (sessionId: string): boolean => {
  const session = sessions.get(sessionId)
  return session?.running ?? false
}

/**
 * Wait for a session to complete.
 */
export const waitForSession = (
  sessionId: string,
  pollIntervalMs = 1000
): Effect.Effect<AgentExecutionResult, AgentSpawnError> =>
  Effect.gen(function* () {
    const session = sessions.get(sessionId)
    if (!session) {
      return yield* Effect.fail(
        new AgentSpawnError({
          message: `Session not found: ${sessionId}`,
          agent: "pi", // Default, we don't know
        })
      )
    }

    // Poll until done
    while (session.running) {
      yield* Effect.sleep(pollIntervalMs)
    }

    return {
      success: session.exitCode === 0,
      output: session.output.join(""),
      exitCode: session.exitCode ?? 1,
      error: session.exitCode !== 0 ? `Exited with code ${session.exitCode}` : undefined,
      durationMs: Date.now() - session.startedAt.getTime(),
    }
  })
