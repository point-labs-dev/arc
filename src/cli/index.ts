import { appendFile, mkdir, readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { PiRpcBackend } from "../backends/pi-rpc"
import {
  AutoApproveInterviewer,
  type CodergenBackend,
  type GraphDefinition,
  type Interviewer,
  type PipelineEvent,
  PipelineContext,
  type PipelineEventEmitter,
  parseDot,
  runPipeline,
  validate,
} from "../engine/index"
import { loadArcConfig } from "./config"
import { collectProjectSnapshot } from "./git"
import { readRecentLearnings } from "./progress"
import { readProjectStatus } from "./status"

export * from "./config"
export * from "./events"
export * from "./git"
export * from "./model"
export * from "./progress"
export * from "./status"

export const version = "0.1.0"

export interface CliResult {
  readonly command: string
  readonly ok: boolean
  readonly stdout: string
  readonly stderr?: string
  readonly exitCode: number
}

interface ParsedArgs {
  readonly command: string
  readonly flags: Record<string, string | boolean>
  readonly positionals: string[]
}

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const parsed = parseArgs(args)
  const command = parsed.command
  const projectRoot = resolve(String(parsed.flags.project ?? process.cwd()))

  try {
    if (command === "help" || command === "--help" || command === "-h") {
      return {
        command: "help",
        ok: true,
        stdout: renderHelp(),
        exitCode: 0,
      }
    }

    if (command === "run") {
      const result = await runPipelineCommand({
        projectRoot,
        positionalPipelinePath: parsed.positionals[0],
        configPath: asOptionalString(parsed.flags.config),
        resume: parsed.flags.resume === true,
        noApprove: parsed.flags["no-approve"] === true,
        streamEvents: parsed.flags["stream-events"] === true,
      })

      return {
        command,
        ok: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.ok ? 0 : 1,
      }
    }

    if (command === "validate") {
      const result = await validatePipelineCommand({
        projectRoot,
        positionalPipelinePath: parsed.positionals[0],
      })

      return {
        command,
        ok: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.ok ? 0 : 1,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      command,
      ok: false,
      stdout: "",
      stderr: message,
      exitCode: 1,
    }
  }
}

const runPipelineCommand = async (input: {
  projectRoot: string
  positionalPipelinePath?: string
  configPath?: string
  resume: boolean
  noApprove: boolean
  streamEvents: boolean
}): Promise<{ ok: boolean; stdout: string; stderr?: string }> => {
  const config = await loadArcConfig({
    projectRoot: input.projectRoot,
    configPath: input.configPath,
  })

  const pipelinePath = await resolvePipelinePath(input.projectRoot, input.positionalPipelinePath)
  const dot = await readFile(pipelinePath, "utf8")
  const graph = parseDot(dot)

  const diagnostics = validate(graph)
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")
  if (errors.length > 0) {
    return {
      ok: false,
      stdout: "",
      stderr: formatDiagnostics(diagnostics),
    }
  }

  const context = await buildInitialContext(input.projectRoot)
  const eventLogPath = join(input.projectRoot, config.monitoring.eventsLogPath)
  const logsRoot = join(input.projectRoot, "progress", "runs", String(Date.now()))
  const checkpointPath = join(input.projectRoot, "progress", "checkpoint.json")

  const backend: CodergenBackend =
    config.backend.mode === "mock"
      ? new MockPiBackend()
      : new PiRpcBackend({
          defaultModel: config.model.default,
          defaultProvider: config.model.provider,
          timeoutMs: Math.max(1, Math.floor(config.backend.timeout * 1_000)),
        })

  const interviewer = input.noApprove
    ? new AutoApproveInterviewer()
    : new StdinInterviewer({ autoApproveFallback: true })

  const emitter = createEventEmitter(eventLogPath, input.streamEvents)
  const maxNodeExecutions = Math.max(10, config.convergence.maxAttempts * 20)

  const result = await runPipeline(graph, {
    logsRoot,
    checkpointPath,
    context,
    eventEmitter: emitter,
    codergenBackend: backend,
    interviewer,
    resumeFromCheckpoint: input.resume,
    maxNodeExecutions,
  })

  const summaryLines = [
    `Pipeline: ${graph.id}`,
    `Status: ${result.status}`,
    `Completed nodes: ${result.completed_nodes.length}`,
    `Checkpoint: ${result.checkpoint_path ?? "(none)"}`,
  ]

  if (result.failure_reason !== undefined && result.failure_reason.trim().length > 0) {
    summaryLines.push(`Failure reason: ${result.failure_reason}`)
  }

  return {
    ok: result.status === "success",
    stdout: summaryLines.join("\n"),
  }
}

const validatePipelineCommand = async (input: {
  projectRoot: string
  positionalPipelinePath?: string
}): Promise<{ ok: boolean; stdout: string; stderr?: string }> => {
  const pipelinePath = await resolvePipelinePath(input.projectRoot, input.positionalPipelinePath)
  const dot = await readFile(pipelinePath, "utf8")
  const graph = parseDot(dot)
  const diagnostics = validate(graph)
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")

  const header = [`Pipeline: ${graph.id}`, `Path: ${pipelinePath}`]
  if (diagnostics.length === 0) {
    return {
      ok: true,
      stdout: [...header, "Diagnostics: clean"].join("\n"),
    }
  }

  const formatted = formatDiagnostics(diagnostics)
  if (errors.length > 0) {
    return {
      ok: false,
      stdout: header.join("\n"),
      stderr: formatted,
    }
  }

  return {
    ok: true,
    stdout: [...header, formatted].join("\n"),
  }
}

const resolvePipelinePath = async (projectRoot: string, positional?: string): Promise<string> => {
  if (positional !== undefined && positional.trim().length > 0) {
    return resolveWithProject(projectRoot, positional)
  }

  const projectPipeline = join(projectRoot, "arc.pipeline.dot")
  if (await fileExists(projectPipeline)) {
    return projectPipeline
  }

  return resolve(process.cwd(), "pipelines", "convergence.dot")
}

const resolveWithProject = (projectRoot: string, target: string): string => {
  if (isAbsolute(target)) {
    return target
  }

  const fromCwd = resolve(process.cwd(), target)
  if (fromCwd.startsWith(projectRoot)) {
    return fromCwd
  }

  return resolve(projectRoot, target)
}

const buildInitialContext = async (projectRoot: string): Promise<PipelineContext> => {
  const specPath = join(projectRoot, "SPEC.md")
  const spec = await readFile(specPath, "utf8")
  const learnings = (await readRecentLearnings(projectRoot, 5)).join("\n\n")
  const projectState = await collectProjectSnapshot(projectRoot)

  return new PipelineContext({
    spec,
    "$spec": spec,
    learnings,
    "$learnings": learnings,
    project_state: projectState,
    "$project_state": projectState,
    satisfaction: 0,
    "$satisfaction": 0,
    satisfaction_passed: false,
    spec_complete: false,
  })
}

const formatDiagnostics = (diagnostics: readonly { severity: string; message: string; rule: string }[]) =>
  diagnostics
    .map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.rule}: ${diagnostic.message}`)
    .join("\n")

const parseArgs = (args: readonly string[]): ParsedArgs => {
  const command = args[0] ?? "help"
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index]

    if (token === "--resume" || token === "--no-approve" || token === "--stream-events") {
      flags[token.replace(/^--/, "")] = true
      continue
    }

    if (token === "--project" || token === "-p" || token === "--config") {
      const value = args[index + 1]
      if (value !== undefined) {
        const key = token === "--project" || token === "-p" ? "project" : "config"
        flags[key] = value
        index += 1
      }
      continue
    }

    if (token.startsWith("--")) {
      continue
    }

    positionals.push(token)
  }

  return {
    command,
    flags,
    positionals,
  }
}

const renderHelp = (): string =>
  [
    "Arc CLI",
    "",
    "Usage:",
    "  arc run [pipeline.dot] [--project <path>] [--resume] [--no-approve] [--stream-events]",
    "  arc validate [pipeline.dot]",
    "  arc status [--project <path>]",
    "",
    "Commands:",
    "  run       Execute a DOT pipeline with the Arc engine",
    "  validate  Parse and validate a DOT pipeline",
    "  status    Show persisted progress and recent learnings",
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

class StdinInterviewer implements Interviewer {
  constructor(private readonly options: { autoApproveFallback: boolean }) {}

  async ask(question: {
    text: string
    type: "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION"
    options?: readonly { key: string; label: string }[]
  }): Promise<{ value: string; selected_option?: { key: string; label: string } }> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      if (this.options.autoApproveFallback) {
        return autoApprove(question)
      }
      return { value: "SKIPPED" }
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      if (question.type === "MULTIPLE_CHOICE" && (question.options?.length ?? 0) > 0) {
        const options = question.options ?? []
        const optionLines = options.map((option) => `  [${option.key}] ${option.label}`)
        const answer = await rl.question(`${question.text}\n${optionLines.join("\n")}\n> `)
        const selected = options.find(
          (option) => option.key.toLowerCase() === answer.trim().toLowerCase(),
        )
        if (selected !== undefined) {
          return { value: selected.key, selected_option: selected }
        }
        return { value: answer.trim() }
      }

      const answer = await rl.question(`${question.text}\n> `)
      return { value: answer.trim().length > 0 ? answer.trim() : "SKIPPED" }
    } finally {
      rl.close()
    }
  }
}

const autoApprove = (question: {
  type: "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION"
  options?: readonly { key: string; label: string }[]
}): { value: string; selected_option?: { key: string; label: string } } => {
  if (question.type === "YES_NO" || question.type === "CONFIRMATION") {
    return { value: "YES" }
  }

  if (question.type === "MULTIPLE_CHOICE" && (question.options?.length ?? 0) > 0) {
    const first = question.options?.[0]
    if (first !== undefined) {
      return { value: first.key, selected_option: first }
    }
  }

  return { value: "auto-approved" }
}

const createEventEmitter = (
  eventLogPath: string,
  streamEvents: boolean,
): PipelineEventEmitter => {
  return {
    emit: async (event: PipelineEvent): Promise<void> => {
      await mkdir(dirname(eventLogPath), { recursive: true })
      await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8")

      if (streamEvents) {
        process.stdout.write(`[event] ${JSON.stringify(event)}\n`)
      }
    },
  }
}

class MockPiBackend implements CodergenBackend {
  async run(node: GraphDefinition["nodes"][number]): Promise<string> {
    if (node.id === "Satisfaction") {
      return JSON.stringify({
        status: "success",
        context_updates: {
          satisfaction: 1,
          satisfaction_passed: true,
        },
      })
    }

    if (node.id === "MoreSpec") {
      return JSON.stringify({
        status: "success",
        context_updates: {
          spec_complete: true,
        },
      })
    }

    return "mock response"
  }
}

const asOptionalString = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf8")
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

const isMissingFileError = (value: unknown): value is NodeJS.ErrnoException =>
  typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT"
