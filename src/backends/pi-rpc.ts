import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"

import {
  failOutcome,
  type CodergenBackend,
  type GraphNode,
  type Outcome,
  type PipelineContext,
} from "../engine/index"

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_PROVIDER = "anthropic"

export interface PiRpcCommand {
  readonly type: "prompt" | "steer" | "follow_up" | "abort" | "get_state"
  readonly message?: string
}

export interface PiRpcLaunchCommand {
  readonly command: string
  readonly args: readonly string[]
}

export interface PiRpcEvent {
  readonly nodeId: string
  readonly payload: Record<string, unknown>
}

export interface PiRpcBackendOptions {
  readonly executable?: string
  readonly defaultModel?: string
  readonly defaultProvider?: string
  readonly timeoutMs?: number
  readonly extraArgs?: readonly string[]
  readonly launchCommand?: (node: GraphNode) => PiRpcLaunchCommand
  readonly onEvent?: (event: PiRpcEvent) => Promise<void> | void
}

export class PiRpcBackend implements CodergenBackend {
  constructor(private readonly options: PiRpcBackendOptions = {}) {}

  async run(node: GraphNode, prompt: string, context: PipelineContext): Promise<string | Outcome> {
    const launch = this.resolveLaunchCommand(node)
    const timeoutMs = this.resolveTimeout(node)
    const message = interpolatePromptContext(prompt, context)

    const child = spawn(launch.command, [...launch.args], {
      stdio: "pipe",
      env: process.env,
    })

    const completion = this.createCompletionTracker(child, node)

    try {
      await sendCommand(child, {
        type: "prompt",
        message,
      })

      const timeoutPromise = createTimeout(timeoutMs)
      const result = await Promise.race([completion.promise, timeoutPromise])
      if (result.type === "timeout") {
        await sendCommand(child, { type: "abort" })
        await terminateProcess(child)
        return failOutcome(`Pi RPC timed out after ${timeoutMs}ms`)
      }

      if (result.type === "error") {
        await terminateProcess(child)
        return failOutcome(result.message)
      }

      await terminateProcess(child)
      return result.text.trim().length > 0 ? result.text.trim() : "Pi session completed"
    } catch (error) {
      await terminateProcess(child)
      return failOutcome(error instanceof Error ? error.message : String(error))
    }
  }

  private resolveLaunchCommand(node: GraphNode): PiRpcLaunchCommand {
    if (this.options.launchCommand !== undefined) {
      return this.options.launchCommand(node)
    }

    const executable = this.options.executable ?? "pi"
    const provider = readStringAttr(node.attrs.llm_provider) ?? this.options.defaultProvider ?? DEFAULT_PROVIDER
    const model = readStringAttr(node.attrs.llm_model) ?? this.options.defaultModel ?? DEFAULT_MODEL
    const reasoningEffort = readReasoningEffortAttr(node.attrs.reasoning_effort)

    const args = ["--mode", "rpc", "--provider", provider, "--model", model]
    if (reasoningEffort !== undefined) {
      args.push("--reasoning-effort", reasoningEffort)
    }
    args.push("--no-session")

    return {
      command: executable,
      args: [...args, ...(this.options.extraArgs ?? [])],
    }
  }

  private resolveTimeout(node: GraphNode): number {
    const explicit = readDurationAttrMs(node.attrs.timeout)
    if (explicit !== undefined) {
      return explicit
    }

    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private createCompletionTracker(
    child: ChildProcessWithoutNullStreams,
    node: GraphNode,
  ): {
    readonly promise: Promise<CompletionResult>
  } {
    let settled = false
    let responseText = ""
    let stderrText = ""
    let stdoutBuffer = ""

    const promise = new Promise<CompletionResult>((resolve) => {
      const settle = (value: CompletionResult) => {
        if (settled) {
          return
        }
        settled = true
        resolve(value)
      }

      const handleLine = async (line: string): Promise<void> => {
        if (settled) {
          return
        }

        const payload = parseJsonLine(line)
        if (payload === undefined) {
          return
        }

        await this.emitEvent(node, payload)

        const delta = readTextDelta(payload)
        if (delta !== undefined) {
          responseText += delta
        }

        if (payload.type === "message_end") {
          settle({
            type: "ok",
            text: responseText,
          })
        }
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8")
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ""

        for (const line of lines) {
          handleLine(line).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            settle({
              type: "error",
              message: `Pi RPC event handling failed: ${message}`,
            })
          })
        }
      })

      child.stderr.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString("utf8")
      })

      child.on("error", (error) => {
        settle({
          type: "error",
          message: `Pi RPC spawn failed: ${error.message}`,
        })
      })

      child.on("close", (code, signal) => {
        if (responseText.trim().length > 0) {
          settle({
            type: "ok",
            text: responseText,
          })
          return
        }

        const signalText = signal === null ? "" : `, signal ${signal}`
        const stderrPreview = stderrText.trim().length > 0 ? `: ${stderrText.trim()}` : ""

        settle({
          type: "error",
          message: `Pi RPC exited with code ${code ?? -1}${signalText}${stderrPreview}`,
        })
      })
    })

    return { promise }
  }

  private async emitEvent(node: GraphNode, payload: Record<string, unknown>): Promise<void> {
    if (this.options.onEvent === undefined) {
      return
    }

    await this.options.onEvent({
      nodeId: node.id,
      payload,
    })
  }
}

type CompletionResult =
  | {
      readonly type: "ok"
      readonly text: string
    }
  | {
      readonly type: "error"
      readonly message: string
    }
  | {
      readonly type: "timeout"
    }

const CONTEXT_PROMPT_TOKEN_PATTERN =
  /\$context\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g

const interpolatePromptContext = (prompt: string, context: PipelineContext): string => {
  if (!prompt.includes("$context.")) {
    return prompt
  }

  return prompt.replace(CONTEXT_PROMPT_TOKEN_PATTERN, (_match, key: string) => {
    const value = resolvePromptContextValue(context, key)
    return promptValueToString(value)
  })
}

const resolvePromptContextValue = (context: PipelineContext, key: string): unknown => {
  const direct = context.get(key)
  if (direct !== undefined) {
    return direct
  }

  return context.get(`context.${key}`)
}

const promptValueToString = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  return String(value)
}

const createTimeout = async (timeoutMs: number): Promise<CompletionResult> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })

  return {
    type: "timeout",
  }
}

const sendCommand = async (
  child: ChildProcessWithoutNullStreams,
  command: PiRpcCommand,
): Promise<void> => {
  if (child.stdin.destroyed || !child.stdin.writable) {
    return
  }

  const line = `${JSON.stringify(command)}\n`
  await new Promise<void>((resolve, reject) => {
    child.stdin.write(line, (error) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const terminateProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.killed) {
    return
  }

  if (child.exitCode !== null) {
    return
  }

  child.kill("SIGTERM")

  try {
    await Promise.race([
      once(child, "close"),
      new Promise((resolve) => {
        setTimeout(resolve, 2_000)
      }),
    ])
  } catch {
    // no-op
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL")
  }
}

const parseJsonLine = (line: string): Record<string, unknown> | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== "object" || parsed === null) {
      return undefined
    }

    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

const readTextDelta = (payload: Record<string, unknown>): string | undefined => {
  if (payload.type === "text_delta" && typeof payload.content === "string") {
    return payload.content
  }

  if (payload.type !== "message_update") {
    return undefined
  }

  const assistantMessageEvent = payload.assistantMessageEvent
  if (typeof assistantMessageEvent !== "object" || assistantMessageEvent === null) {
    return undefined
  }

  if (
    "type" in assistantMessageEvent &&
    assistantMessageEvent.type === "text_delta" &&
    "delta" in assistantMessageEvent &&
    typeof assistantMessageEvent.delta === "string"
  ) {
    return assistantMessageEvent.delta
  }

  if (
    "type" in assistantMessageEvent &&
    assistantMessageEvent.type === "text" &&
    "text" in assistantMessageEvent &&
    typeof assistantMessageEvent.text === "string"
  ) {
    return assistantMessageEvent.text
  }

  return undefined
}

const readStringAttr = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const readReasoningEffortAttr = (value: unknown): "low" | "medium" | "high" | undefined => {
  const parsed = readStringAttr(value)
  if (parsed === undefined) {
    return undefined
  }

  if (parsed === "low" || parsed === "medium" || parsed === "high") {
    return parsed
  }

  return undefined
}

const readDurationAttrMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value !== "object" || value === null) {
    return undefined
  }

  if ("milliseconds" in value && typeof value.milliseconds === "number") {
    return value.milliseconds > 0 ? Math.floor(value.milliseconds) : undefined
  }

  return undefined
}
