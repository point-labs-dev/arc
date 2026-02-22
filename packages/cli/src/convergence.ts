import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { MockBackendFactory } from "./backend"
import { loadArcConfig } from "./config"
import { createEvent, type ArcEventSink, CompositeArcEventSink, NdjsonArcEventSink } from "./events"
import { collectProjectSnapshot, type GitClient, ShellGitClient } from "./git"
import type {
  AttemptBackendFactory,
  ConvergenceResult,
  ProgressState,
  VerificationResult,
} from "./model"
import { buildAttemptPrompt } from "./prompt"
import {
  extractSpecItems,
  loadProgressState,
  persistAttemptLearning,
  readRecentLearnings,
  saveProgressState,
} from "./progress"
import { runVerification } from "./verification"

export interface RunConvergenceOptions {
  readonly projectRoot: string
  readonly specPath?: string
  readonly configPath?: string
  readonly backendFactory?: AttemptBackendFactory
  readonly gitClient?: GitClient
  readonly eventSink?: ArcEventSink
  readonly verificationRunner?: typeof runVerification
}

export const runConvergence = async (
  options: RunConvergenceOptions,
): Promise<ConvergenceResult> => {
  const specPath = options.specPath ?? join(options.projectRoot, "SPEC.md")
  const specText = await readFile(specPath, "utf8")
  const config = await loadArcConfig({
    projectRoot: options.projectRoot,
    configPath: options.configPath,
  })

  if (!config.convergence.freshContextPerAttempt) {
    throw new Error("freshContextPerAttempt must remain enabled")
  }

  const progress = await loadProgressState(options.projectRoot, specText)
  const gitClient = options.gitClient ?? new ShellGitClient()
  const isGitRepo = await gitClient.isRepository(options.projectRoot)

  const baseSink =
    options.eventSink === undefined
      ? new NdjsonArcEventSink(join(options.projectRoot, config.monitoring.eventsLogPath))
      : new CompositeArcEventSink([
          options.eventSink,
          new NdjsonArcEventSink(join(options.projectRoot, config.monitoring.eventsLogPath)),
        ])

  await baseSink.emit(
    createEvent(0, {
      type: "spec_read",
      specPath,
    }),
  )

  const backendFactory = options.backendFactory ?? new MockBackendFactory()
  const verificationRunner = options.verificationRunner ?? runVerification

  let currentProgress = progress
  const maxAttempts = config.convergence.maxAttempts

  for (
    let attempt = currentProgress.totalAttempts + 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const attemptId = `attempt-${String(attempt).padStart(3, "0")}`
    await baseSink.emit(
      createEvent(attempt, {
        type: "attempt_start",
        attemptId,
        backendMode: config.backend.mode,
      }),
    )

    const prompt = await buildPromptForAttempt({
      projectRoot: options.projectRoot,
      specText,
      attempt,
    })

    const session = await backendFactory.createFreshSession()

    let backendSummary = ""
    let backendResponse = ""
    let backendError: string | undefined

    try {
      const response = await session.run(prompt)
      backendSummary = response.summary
      backendResponse = response.rawResponse

      await baseSink.emit(
        createEvent(attempt, {
          type: "attempt_end",
          attemptId,
          backendSummary,
          success: true,
        }),
      )
    } catch (error) {
      backendError = error instanceof Error ? error.message : String(error)
      backendSummary = `Backend error: ${backendError}`

      await baseSink.emit(
        createEvent(attempt, {
          type: "attempt_end",
          attemptId,
          backendSummary,
          success: false,
        }),
      )
    } finally {
      await session.close()
    }

    const verification =
      backendError === undefined
        ? await verificationRunner({
            projectRoot: options.projectRoot,
            specText,
            implementationSummary: summarizeImplementation(backendResponse, backendSummary),
            commands: config.verification.commands,
            commandTimeoutSeconds: config.verification.timeout,
            holdoutCommand: config.verification.holdout_command,
            holdoutTimeoutSeconds: config.verification.holdout_timeout,
            satisfactionThreshold: config.convergence.satisfactionThreshold,
            attemptNumber: attempt,
            eventSink: baseSink,
          })
        : syntheticFailedVerification(backendError)

    const changedFiles = isGitRepo ? await gitClient.getChangedFiles(options.projectRoot) : []

    if (verification.passed) {
      const commitMessage = `arc: converge attempt ${attempt}`
      const hash = isGitRepo
        ? await gitClient.commitAll(options.projectRoot, commitMessage)
        : undefined

      currentProgress = progressAfterSuccess(currentProgress, specText, attempt, verification)
      await saveProgressState(options.projectRoot, currentProgress)

      if (hash !== undefined) {
        await baseSink.emit(
          createEvent(attempt, {
            type: "commit",
            hash,
            message: commitMessage,
            filesChanged: changedFiles,
          }),
        )
      }

      return {
        success: true,
        attemptsUsed: attempt,
        message: `Spec satisfied in ${attempt} attempt${attempt === 1 ? "" : "s"}`,
      }
    }

    const learningPath = await persistAttemptLearning(options.projectRoot, {
      attemptNumber: attempt,
      attempted: summarizeAttemptObjective(specText),
      worked: deriveWhatWorked(verification),
      failed: deriveWhatFailed(verification, backendError),
      filesChanged: changedFiles,
      verificationSummary: renderVerificationSummary(verification),
      backendSummary,
      keyLearning: deriveKeyLearning(verification, backendError),
    })

    await baseSink.emit(
      createEvent(attempt, {
        type: "learning_persisted",
        path: learningPath,
      }),
    )

    currentProgress = progressAfterFailure(currentProgress, attempt, verification)
    await saveProgressState(options.projectRoot, currentProgress)
  }

  return {
    success: false,
    attemptsUsed: maxAttempts,
    message: `Circuit breaker fired after ${maxAttempts} attempts`,
  }
}

const buildPromptForAttempt = async (input: {
  projectRoot: string
  specText: string
  attempt: number
}): Promise<string> => {
  const learnings = await readRecentLearnings(input.projectRoot, 3)
  const snapshot = await collectProjectSnapshot(input.projectRoot)

  return buildAttemptPrompt({
    specText: input.specText,
    progressLearnings: learnings,
    projectSnapshot: snapshot,
    attemptNumber: input.attempt,
  })
}

const progressAfterSuccess = (
  previous: ProgressState,
  specText: string,
  attempt: number,
  verification: VerificationResult,
): ProgressState => ({
  totalAttempts: attempt,
  specItemsCompleted: extractSpecItems(specText),
  specItemsPending: [],
  lastAttemptAt: new Date().toISOString(),
  overallSatisfaction: verification.satisfaction.score,
})

const progressAfterFailure = (
  previous: ProgressState,
  attempt: number,
  verification: VerificationResult,
): ProgressState => ({
  ...previous,
  totalAttempts: attempt,
  lastAttemptAt: new Date().toISOString(),
  overallSatisfaction: verification.satisfaction.score,
})

const syntheticFailedVerification = (reason: string): VerificationResult => ({
  passed: false,
  standard: {
    passed: false,
    durationMs: 0,
    commands: [
      {
        command: "backend",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: reason,
        durationMs: 0,
      },
    ],
  },
  holdout: {
    passed: false,
    scenarioCount: 0,
    failedScenarioIds: [],
    summary: "Backend failed before holdout execution",
  },
  satisfaction: {
    score: 0,
    threshold: 1,
    passed: false,
    rationale: reason,
  },
})

const summarizeAttemptObjective = (specText: string): string => {
  const firstHeading = specText
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("## "))

  return firstHeading?.replace(/^##\s+/, "") ?? "Advance the project toward full spec satisfaction"
}

const deriveWhatWorked = (verification: VerificationResult): string[] => {
  const worked: string[] = []
  if (verification.standard.passed) {
    worked.push("Standard verification commands passed")
  }
  if (verification.holdout.passed) {
    worked.push(`Holdout scenarios passed (${verification.holdout.scenarioCount})`)
  }
  if (verification.satisfaction.passed) {
    worked.push(
      `Satisfaction score ${verification.satisfaction.score.toFixed(3)} met threshold ${verification.satisfaction.threshold.toFixed(3)}`,
    )
  }

  return worked
}

const deriveWhatFailed = (verification: VerificationResult, backendError: string | undefined): string[] => {
  const failed: string[] = []

  if (backendError !== undefined) {
    failed.push(`Backend failed: ${backendError}`)
  }

  for (const result of verification.standard.commands) {
    if (result.passed) {
      continue
    }
    failed.push(`Verification command failed: ${result.command} (exit ${result.exitCode})`)
  }

  if (!verification.holdout.passed) {
    failed.push(
      `Holdout failed: ${verification.holdout.failedScenarioIds.join(", ") || verification.holdout.summary}`,
    )
  }

  if (!verification.satisfaction.passed) {
    failed.push(
      `Satisfaction score ${verification.satisfaction.score.toFixed(3)} below ${verification.satisfaction.threshold.toFixed(3)}`,
    )
  }

  return failed
}

const deriveKeyLearning = (verification: VerificationResult, backendError: string | undefined): string => {
  if (backendError !== undefined) {
    return `Stabilize backend execution before running verification: ${backendError}`
  }

  if (!verification.standard.passed) {
    const firstFailure = verification.standard.commands.find((result) => !result.passed)
    return `Fix failing verification command first: ${firstFailure?.command ?? "unknown"}`
  }

  if (!verification.holdout.passed) {
    return `Address holdout gaps: ${verification.holdout.failedScenarioIds.join(", ") || "unknown scenario"}`
  }

  if (!verification.satisfaction.passed) {
    return `Improve implementation completeness to raise satisfaction score (current ${verification.satisfaction.score.toFixed(3)})`
  }

  return "Verification passed; proceed to commit"
}

const renderVerificationSummary = (verification: VerificationResult): string => {
  const commandLines = verification.standard.commands.map(
    (result) => `- ${result.command}: ${result.passed ? "pass" : `fail (exit ${result.exitCode})`}`,
  )

  return [
    `Standard: ${verification.standard.passed ? "pass" : "fail"}`,
    ...commandLines,
    `Holdout: ${verification.holdout.passed ? "pass" : "fail"} (${verification.holdout.scenarioCount} scenarios)`,
    `Satisfaction: ${verification.satisfaction.score.toFixed(3)} / ${verification.satisfaction.threshold.toFixed(3)} (${verification.satisfaction.passed ? "pass" : "fail"})`,
  ].join("\n")
}

const summarizeImplementation = (rawResponse: string, summary: string): string => {
  const trimmedResponse = rawResponse.trim()
  if (trimmedResponse.length > 0) {
    return trimmedResponse
  }
  return summary
}
