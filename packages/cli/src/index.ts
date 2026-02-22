import { resolve } from "node:path"

import { runConvergence } from "./convergence"
import { readProjectStatus } from "./status"

export * from "./backend"
export * from "./config"
export * from "./convergence"
export * from "./events"
export * from "./git"
export * from "./model"
export * from "./progress"
export * from "./prompt"
export * from "./status"
export * from "./verification"

export const version = "0.1.0"

export interface CliResult {
  readonly command: string
  readonly ok: boolean
  readonly stdout: string
  readonly stderr?: string
  readonly exitCode: number
}

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const command = args[0] ?? "help"
  const flags = parseFlags(args.slice(1))
  const projectRoot = resolve(flags.project ?? process.cwd())

  if (command === "help" || command === "--help" || command === "-h") {
    return {
      command: "help",
      ok: true,
      stdout: renderHelp(),
      exitCode: 0,
    }
  }

  if (command === "run") {
    const result = await runConvergence({
      projectRoot,
      specPath: flags.spec,
      configPath: flags.config,
    })

    return {
      command,
      ok: result.success,
      stdout: result.message,
      exitCode: result.success ? 0 : 1,
    }
  }

  if (command === "status") {
    const status = await readProjectStatus(projectRoot)
    return {
      command,
      ok: true,
      stdout: formatStatus(status),
      exitCode: 0,
    }
  }

  return {
    command,
    ok: false,
    stdout: "",
    stderr: `Unknown command: ${command}`,
    exitCode: 1,
  }
}

const parseFlags = (args: readonly string[]): Record<string, string> => {
  const flags: Record<string, string> = {}

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]

    if (token === "--project" || token === "-p") {
      const value = args[index + 1]
      if (value !== undefined) {
        flags.project = value
        index += 1
      }
      continue
    }

    if (token === "--spec") {
      const value = args[index + 1]
      if (value !== undefined) {
        flags.spec = value
        index += 1
      }
      continue
    }

    if (token === "--config") {
      const value = args[index + 1]
      if (value !== undefined) {
        flags.config = value
        index += 1
      }
    }
  }

  return flags
}

const renderHelp = (): string =>
  [
    "Arc CLI",
    "",
    "Usage:",
    "  arc run [--project <path>] [--spec <path>] [--config <path>]",
    "  arc status [--project <path>]",
    "",
    "Commands:",
    "  run     Execute the convergence loop",
    "  status  Show persisted progress and recent learnings",
  ].join("\n")

const formatStatus = (status: {
  configMode: string
  attempts: number
  completedItems: readonly string[]
  pendingItems: readonly string[]
  lastAttemptAt: string | null
  overallSatisfaction: number
  recentLearnings: readonly string[]
}): string => {
  const completed = status.completedItems.length
  const pending = status.pendingItems.length

  return [
    `Backend mode: ${status.configMode}`,
    `Attempts: ${status.attempts}`,
    `Completed spec items: ${completed}`,
    `Pending spec items: ${pending}`,
    `Last attempt: ${status.lastAttemptAt ?? "never"}`,
    `Overall satisfaction: ${status.overallSatisfaction.toFixed(3)}`,
    `Recent learnings: ${status.recentLearnings.length}`,
  ].join("\n")
}
