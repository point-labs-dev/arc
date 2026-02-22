import { exec } from "node:child_process"
import { promisify } from "node:util"

import { readAttributeDurationMilliseconds, readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import { type Outcome, failOutcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"

const execAsync = promisify(exec)

export interface ToolResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export type ToolRunner = (command: string, timeoutMs?: number) => Promise<ToolResult>

export class ToolHandler implements Handler {
  private readonly runner: ToolRunner

  constructor(runner: ToolRunner = runToolCommand) {
    this.runner = runner
  }

  async execute(
    node: GraphNode,
    _context: PipelineContext,
    _graph: GraphDefinition,
    _logsRoot?: string,
  ): Promise<Outcome> {
    const command = readAttributeString(node.attrs, "tool_command").trim()
    if (command.length === 0) {
      return failOutcome("No tool_command specified")
    }

    const timeoutMs = readAttributeDurationMilliseconds(node.attrs, "timeout")

    try {
      const result = await this.runner(command, timeoutMs)
      if (result.exitCode !== 0) {
        return failOutcome(result.stderr.trim() || `Tool exited with code ${result.exitCode}`)
      }

      return successOutcome({
        notes: `Tool completed: ${command}`,
        context_updates: {
          "tool.output": result.stdout,
        },
      })
    } catch (error) {
      return failOutcome(error instanceof Error ? error.message : String(error))
    }
  }
}

const runToolCommand: ToolRunner = async (command, timeoutMs) => {
  try {
    const result = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    if (isExecError(error)) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        exitCode: typeof error.code === "number" ? error.code : 1,
      }
    }
    throw error
  }
}

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value
