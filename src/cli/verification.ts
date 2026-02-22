import { exec } from "node:child_process"
import { access } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import {
  createCommandHoldoutExecutor,
  createCommandSatisfactionJudge,
  evaluateSatisfaction,
  runHoldoutScenarios,
} from "../engine/index"

import { createEvent, type ArcEventSink, NoopArcEventSink } from "./events"
import type {
  HoldoutVerificationResult,
  SatisfactionVerificationResult,
  StandardCommandResult,
  StandardVerificationResult,
  VerificationResult,
} from "./model"

const execAsync = promisify(exec)
const COMMAND_MAX_BUFFER = 12 * 1024 * 1024

export interface RunVerificationOptions {
  readonly projectRoot: string
  readonly specText: string
  readonly implementationSummary: string
  readonly commands: readonly string[]
  readonly commandTimeoutSeconds: number
  readonly holdoutCommand?: string
  readonly holdoutTimeoutSeconds?: number
  readonly satisfactionThreshold: number
  readonly satisfactionCommand?: string
  readonly attemptNumber: number
  readonly eventSink?: ArcEventSink
}

export const runVerification = async (
  options: RunVerificationOptions,
): Promise<VerificationResult> => {
  const eventSink = options.eventSink ?? new NoopArcEventSink()
  await eventSink.emit(
    createEvent(options.attemptNumber, {
      type: "verification_start",
      commandCount: options.commands.length,
    }),
  )

  const standard = await runStandardVerification(options)
  const holdout = await runHoldoutVerification(options)
  const satisfaction = await runSatisfactionVerification({
    specText: options.specText,
    implementationSummary: options.implementationSummary,
    standard,
    holdout,
    threshold: options.satisfactionThreshold,
    command: options.satisfactionCommand,
    attemptNumber: options.attemptNumber,
    eventSink,
  })

  const passed = standard.passed && holdout.passed && satisfaction.passed
  const summary = buildVerificationSummary(standard, holdout, satisfaction)

  await eventSink.emit(
    createEvent(options.attemptNumber, {
      type: "verification_end",
      passed,
      summary,
    }),
  )

  return {
    passed,
    standard,
    holdout,
    satisfaction,
  }
}

export const runStandardVerification = async (
  options: Pick<
    RunVerificationOptions,
    "projectRoot" | "commands" | "commandTimeoutSeconds"
  >,
): Promise<StandardVerificationResult> => {
  const startedAt = Date.now()
  const results: StandardCommandResult[] = []

  for (const command of options.commands) {
    const result = await runShellCommand(command, {
      cwd: options.projectRoot,
      timeoutMs: Math.max(1, Math.floor(options.commandTimeoutSeconds * 1000)),
    })
    results.push(result)
  }

  return {
    passed: results.every((result) => result.passed),
    commands: results,
    durationMs: Date.now() - startedAt,
  }
}

const runHoldoutVerification = async (
  options: Pick<
    RunVerificationOptions,
    | "projectRoot"
    | "attemptNumber"
    | "eventSink"
    | "holdoutCommand"
    | "holdoutTimeoutSeconds"
    | "commands"
  >,
): Promise<HoldoutVerificationResult> => {
  const eventSink = options.eventSink ?? new NoopArcEventSink()
  const scenariosRoot = join(options.projectRoot, "scenarios")

  const hasScenarios = await fileExists(scenariosRoot)
  const fallbackCommand = options.commands[0] ?? "npm test"
  const holdoutCommand = options.holdoutCommand ?? fallbackCommand
  const timeoutMs =
    options.holdoutTimeoutSeconds === undefined
      ? undefined
      : Math.max(1, Math.floor(options.holdoutTimeoutSeconds * 1000))

  await eventSink.emit(
    createEvent(options.attemptNumber, {
      type: "holdout_start",
      scenarioCount: 0,
    }),
  )

  if (!hasScenarios) {
    const missingResult: HoldoutVerificationResult = {
      passed: false,
      scenarioCount: 0,
      failedScenarioIds: [],
      summary: `No scenarios directory at ${scenariosRoot}`,
    }

    await eventSink.emit(
      createEvent(options.attemptNumber, {
        type: "holdout_end",
        scenarioCount: 0,
        passed: false,
        failedScenarioIds: [],
      }),
    )

    return missingResult
  }

  const runResult = await runHoldoutScenarios({
    scenarios_root: scenariosRoot,
    executor: createCommandHoldoutExecutor({
      command: holdoutCommand,
      cwd: options.projectRoot,
      timeout_ms: timeoutMs,
    }),
    on_event: async (event) => {
      if (event.type === "holdout_start") {
        await eventSink.emit(
          createEvent(options.attemptNumber, {
            type: "holdout_start",
            scenarioCount: event.scenario_count,
          }),
        )
      }

      if (event.type === "holdout_end") {
        await eventSink.emit(
          createEvent(options.attemptNumber, {
            type: "holdout_end",
            scenarioCount: event.scenario_count,
            passed: event.passed,
            failedScenarioIds: event.failed_scenario_ids,
          }),
        )
      }
    },
  })

  return {
    passed: runResult.passed,
    scenarioCount: runResult.scenario_count,
    failedScenarioIds: runResult.failed_scenario_ids,
    summary: runResult.passed
      ? `Holdout passed (${runResult.scenario_count} scenarios)`
      : `Holdout failed: ${runResult.failed_scenario_ids.join(", ") || runResult.failure_reason || "unknown"}`,
  }
}

const runSatisfactionVerification = async (input: {
  specText: string
  implementationSummary: string
  standard: StandardVerificationResult
  holdout: HoldoutVerificationResult
  threshold: number
  command?: string
  attemptNumber: number
  eventSink: ArcEventSink
}): Promise<SatisfactionVerificationResult> => {
  const judge =
    input.command === undefined
      ? undefined
      : createCommandSatisfactionJudge({
          command: input.command,
        })

  const result = await evaluateSatisfaction({
    input: {
      spec_text: input.specText,
      implementation_summary: input.implementationSummary,
      standard_verification_passed: input.standard.passed,
      holdout: {
        passed: input.holdout.passed,
        scenario_count: input.holdout.scenarioCount,
        failed_scenario_ids: input.holdout.failedScenarioIds,
      },
    },
    threshold: input.threshold,
    judge,
    allow_heuristic_fallback: input.command === undefined,
  })

  await input.eventSink.emit(
    createEvent(input.attemptNumber, {
      type: "satisfaction_score",
      score: result.score,
      threshold: result.threshold,
      passed: result.passed,
    }),
  )

  return {
    score: result.score,
    threshold: result.threshold,
    passed: result.passed,
    rationale: result.rationale,
  }
}

const runShellCommand = async (
  command: string,
  options: {
    cwd: string
    timeoutMs: number
  },
): Promise<StandardCommandResult> => {
  const startedAt = Date.now()

  try {
    const result = await execAsync(command, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: COMMAND_MAX_BUFFER,
      env: process.env,
    })

    return {
      command,
      passed: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (!isExecError(error)) {
      throw error
    }

    return {
      command,
      passed: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      durationMs: Date.now() - startedAt,
    }
  }
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const buildVerificationSummary = (
  standard: StandardVerificationResult,
  holdout: HoldoutVerificationResult,
  satisfaction: SatisfactionVerificationResult,
): string => {
  const commandFailures = standard.commands
    .filter((result) => !result.passed)
    .map((result) => `${result.command} (exit ${result.exitCode})`)

  const standardText = commandFailures.length
    ? `Standard failed: ${commandFailures.join(", ")}`
    : "Standard passed"
  const holdoutText = holdout.passed
    ? `Holdout passed (${holdout.scenarioCount})`
    : `Holdout failed: ${holdout.failedScenarioIds.join(", ") || "unknown"}`

  return `${standardText}; ${holdoutText}; satisfaction ${satisfaction.score.toFixed(3)}/${satisfaction.threshold.toFixed(3)}`
}

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value
