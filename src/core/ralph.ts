/**
 * Ralph Loop - Phase 2
 * 
 * The true Ralph Wiggum paradigm:
 * "while :; do cat PROMPT.md | claude-code ; done"
 * 
 * Key insight: Keep iterating on the SAME step until it passes,
 * not just try once and move on.
 * 
 * Features:
 * - Per-step iteration until verification passes
 * - Circuit breaker (stops if no file changes after N iterations)
 * - Full context of previous attempts passed to LLM
 * - Hand-crank mode with review/tune capabilities
 */

import { Effect } from "effect"
import { Data } from "effect"
import type { Plan, Step } from "../types/plan"
import { updateStep, getCurrentStep, isComplete } from "../types/plan"
import { 
  createSnapshot, 
  formatChangeSummary,
  type DiffSnapshot,
} from "./diff"

// === Errors ===

export class RalphLoopError extends Data.TaggedError("RalphLoopError")<{
  readonly message: string
  readonly step?: string
  readonly iteration?: number
}> {}

export class CircuitBreakerTripped extends Data.TaggedError("CircuitBreakerTripped")<{
  readonly message: string
  readonly noChangeIterations: number
  readonly stepId: string
}> {}

export class UserStopped extends Data.TaggedError("UserStopped")<{
  readonly message: string
}> {}

export class MaxIterationsReached extends Data.TaggedError("MaxIterationsReached")<{
  readonly message: string
  readonly iterations: number
  readonly stepId: string
}> {}

// === Types ===

export interface RalphConfig {
  /** Working directory for git operations */
  cwd: string
  /** Max iterations per step before giving up */
  maxIterationsPerStep: number
  /** Max consecutive iterations with no file changes (circuit breaker) */
  maxNoChangeIterations: number
  /** Max total iterations across all steps */
  maxTotalIterations: number
  /** Hand-crank mode - pause after each iteration */
  crankMode: boolean
  /** Callback to execute a step */
  executor: StepExecutor
  /** Callback for events */
  onEvent?: (event: RalphEvent) => void
  /** Callback for crank mode interaction */
  onCrank?: () => Promise<CrankAction>
}

export type CrankAction = 
  | { type: "continue" }
  | { type: "review" }
  | { type: "tune"; newPrompt: string }
  | { type: "skip" }
  | { type: "stop" }

export interface StepExecutor {
  (step: Step, context: ExecutionContext): Promise<ExecutionResult>
}

export interface ExecutionContext {
  plan: Plan
  iteration: number
  stepIteration: number
  previousAttempts: AttemptRecord[]
  promptOverride?: string
}

export interface AttemptRecord {
  iteration: number
  output: string
  error?: string
  changes: DiffSnapshot
  verificationPassed: boolean
}

export interface ExecutionResult {
  success: boolean
  output: string
  verificationPassed: boolean
  error?: string
}

// === Events ===

export type RalphEvent =
  | { type: "loop_start"; plan: Plan }
  | { type: "step_start"; step: Step; stepIteration: number; totalIteration: number }
  | { type: "step_iteration_end"; step: Step; result: ExecutionResult; changes: DiffSnapshot; stepIteration: number }
  | { type: "step_complete"; step: Step; iterations: number }
  | { type: "step_failed"; step: Step; reason: string; iterations: number }
  | { type: "circuit_breaker"; step: Step; noChangeCount: number }
  | { type: "loop_complete"; plan: Plan; totalIterations: number }
  | { type: "loop_stopped"; reason: string }
  | { type: "crank_pause"; step: Step; stepIteration: number }

// === Ralph Loop Implementation ===

/**
 * Run the Ralph loop on a plan.
 * 
 * For each step:
 * 1. Execute the step via executor
 * 2. Check verification
 * 3. If passed, move to next step
 * 4. If failed, iterate again with context of previous attempts
 * 5. Circuit breaker triggers if no file changes for N iterations
 */
export const runRalphLoop = (
  plan: Plan,
  config: RalphConfig
): Effect.Effect<Plan, RalphLoopError | CircuitBreakerTripped | UserStopped | MaxIterationsReached> =>
  Effect.gen(function* () {
    const emit = (event: RalphEvent) => config.onEvent?.(event)
    
    let currentPlan = plan
    let totalIterations = 0
    let stopped = false

    emit({ type: "loop_start", plan })

    // Process each step
    while (!isComplete(currentPlan) && !stopped) {
      const step = getCurrentStep(currentPlan)
      if (!step) break

      // Track attempts for this step
      const attempts: AttemptRecord[] = []
      let stepIteration = 0
      let noChangeCount = 0
      let stepComplete = false
      let promptOverride: string | undefined

      // Update step status
      currentPlan = updateStep(currentPlan, step.id, { 
        status: "in_progress",
        attempts: 0,
      })

      // Ralph loop for this step - keep trying until verification passes
      while (!stepComplete && stepIteration < config.maxIterationsPerStep) {
        stepIteration++
        totalIterations++

        // Check total iteration limit
        if (totalIterations > config.maxTotalIterations) {
          return yield* Effect.fail(new MaxIterationsReached({
            message: `Exceeded max total iterations (${config.maxTotalIterations})`,
            iterations: totalIterations,
            stepId: step.id,
          }))
        }

        emit({ 
          type: "step_start", 
          step, 
          stepIteration, 
          totalIteration: totalIterations 
        })

        // Build execution context with previous attempts
        const context: ExecutionContext = {
          plan: currentPlan,
          iteration: totalIterations,
          stepIteration,
          previousAttempts: attempts,
          promptOverride,
        }

        // Execute the step
        const result = yield* Effect.tryPromise({
          try: () => config.executor(step, context),
          catch: (e) => new RalphLoopError({
            message: `Execution failed: ${e instanceof Error ? e.message : "Unknown"}`,
            step: step.id,
            iteration: stepIteration,
          }),
        })

        // Create git snapshot to track changes
        const snapshot = yield* createSnapshot(
          config.cwd,
          `Arc: ${step.id} iteration ${stepIteration}`
        ).pipe(
          Effect.catchAll((e) => Effect.succeed({
            hash: "",
            timestamp: Date.now(),
            changes: [],
          } as DiffSnapshot))
        )

        // Record this attempt
        attempts.push({
          iteration: stepIteration,
          output: result.output,
          error: result.error,
          changes: snapshot,
          verificationPassed: result.verificationPassed,
        })

        emit({
          type: "step_iteration_end",
          step,
          result,
          changes: snapshot,
          stepIteration,
        })

        // Check circuit breaker - no file changes
        if (snapshot.changes.length === 0) {
          noChangeCount++
          if (noChangeCount >= config.maxNoChangeIterations) {
            emit({ type: "circuit_breaker", step, noChangeCount })
            return yield* Effect.fail(new CircuitBreakerTripped({
              message: `No file changes for ${noChangeCount} consecutive iterations`,
              noChangeIterations: noChangeCount,
              stepId: step.id,
            }))
          }
        } else {
          noChangeCount = 0 // Reset on any change
        }

        // Check if verification passed
        if (result.verificationPassed) {
          stepComplete = true
          currentPlan = updateStep(currentPlan, step.id, {
            status: "completed",
            completedAt: new Date().toISOString(),
            attempts: stepIteration,
          })
          emit({ type: "step_complete", step, iterations: stepIteration })
        } else {
          // Update attempt count
          currentPlan = updateStep(currentPlan, step.id, {
            attempts: stepIteration,
            lastError: result.error || "Verification failed",
          })

          // Hand-crank mode - pause for user input
          if (config.crankMode && config.onCrank) {
            emit({ type: "crank_pause", step, stepIteration })
            
            const action = yield* Effect.tryPromise({
              try: () => config.onCrank!(),
              catch: (e) => new RalphLoopError({
                message: `Crank interaction failed: ${e}`,
              }),
            })

            switch (action.type) {
              case "continue":
                // Just continue to next iteration
                promptOverride = undefined
                break
              case "review":
                // Review handled by UI, continue after
                promptOverride = undefined
                break
              case "tune":
                // Use the tuned prompt for next iteration
                promptOverride = action.newPrompt
                break
              case "skip":
                // Skip this step
                stepComplete = true
                currentPlan = updateStep(currentPlan, step.id, {
                  status: "skipped",
                })
                break
              case "stop":
                stopped = true
                emit({ type: "loop_stopped", reason: "User stopped" })
                return yield* Effect.fail(new UserStopped({
                  message: "User requested stop",
                }))
            }
          }
        }
      }

      // If we exhausted iterations without completing
      if (!stepComplete) {
        emit({ 
          type: "step_failed", 
          step, 
          reason: "Max iterations reached",
          iterations: stepIteration,
        })
        currentPlan = updateStep(currentPlan, step.id, {
          status: "failed",
          lastError: `Failed after ${stepIteration} iterations`,
        })
      }
    }

    emit({ type: "loop_complete", plan: currentPlan, totalIterations })
    return currentPlan
  })

/**
 * Build enhanced prompt with context from previous attempts.
 * 
 * This is key to the Ralph paradigm - each iteration gets
 * context about what was tried before and what went wrong.
 */
export const buildContextualPrompt = (
  basePrompt: string,
  attempts: AttemptRecord[]
): string => {
  if (attempts.length === 0) {
    return basePrompt
  }

  const parts: string[] = [basePrompt]

  parts.push("\n---\n## Previous Attempts\n")
  parts.push("The following attempts have been made. Learn from what went wrong:\n")

  for (const attempt of attempts.slice(-3)) { // Last 3 attempts
    parts.push(`### Attempt ${attempt.iteration}`)
    
    if (attempt.changes.changes.length > 0) {
      parts.push(`Files changed: ${formatChangeSummary(attempt.changes.changes)}`)
    } else {
      parts.push("⚠️ No files were changed in this attempt")
    }

    if (attempt.error) {
      parts.push(`❌ Error: ${attempt.error}`)
    }

    if (!attempt.verificationPassed) {
      parts.push("❌ Verification failed")
    }

    parts.push("")
  }

  parts.push("---\n")
  parts.push("Try a different approach based on what you learned from previous attempts.")

  return parts.join("\n")
}
