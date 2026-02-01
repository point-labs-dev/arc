/**
 * Ralph Loop
 * 
 * The heart of Ralph - implements Geoff Huntley's agentic loop pattern.
 * 
 * "while :; do cat PROMPT.md | claude-code ; done"
 * 
 * But with:
 * - Full observability
 * - Verification at each step
 * - Context management
 * - Hand-cranking support
 */

import { Effect, Stream, Ref, pipe } from "effect"
import { Data } from "effect"
import type { Plan, Step } from "../types/plan"
import { getCurrentStep, updateStep, isComplete } from "../types/plan"
import type { RalphEvent, EventEmitter } from "../types/events"
import { iterationStart, iterationEnd, error } from "../types/events"

// === Errors ===

export class LoopError extends Data.TaggedError("LoopError")<{
  readonly message: string
  readonly step?: string
  readonly iteration?: number
}> {}

export class CircuitBreakerError extends Data.TaggedError("CircuitBreakerError")<{
  readonly message: string
  readonly noChangeCount: number
}> {}

export class UserStopError extends Data.TaggedError("UserStopError")<{
  readonly message: string
}> {}

// === Loop State ===

export interface LoopState {
  readonly plan: Plan
  readonly iteration: number
  readonly noChangeCount: number
  readonly startTime: number
  readonly stopped: boolean
}

export const initialState = (plan: Plan): LoopState => ({
  plan,
  iteration: 0,
  noChangeCount: 0,
  startTime: Date.now(),
  stopped: false,
})

// === Loop Configuration ===

export interface LoopConfig {
  readonly maxIterations: number
  readonly maxNoChange: number
  readonly timeoutMs: number
  readonly crankMode: boolean
  readonly onCrank?: () => Effect.Effect<"continue" | "review" | "tune" | "stop">
  readonly executor: StepExecutor
  readonly verifier: StepVerifier
  readonly events: EventEmitter
}

// === Executor Interface ===

export interface StepExecutor {
  execute: (
    step: Step,
    context: ExecutionContext
  ) => Effect.Effect<ExecutionResult, LoopError>
}

export interface ExecutionContext {
  readonly plan: Plan
  readonly iteration: number
  readonly previousResult?: ExecutionResult
}

export interface ExecutionResult {
  readonly success: boolean
  readonly output: string
  readonly changes: FileChange[]
  readonly error?: string
}

export interface FileChange {
  readonly path: string
  readonly type: "created" | "modified" | "deleted"
}

// === Verifier Interface ===

export interface StepVerifier {
  verify: (step: Step) => Effect.Effect<VerificationResult, LoopError>
}

export interface VerificationResult {
  readonly passed: boolean
  readonly message: string
  readonly details?: string
}

// === Loop Implementation ===

/**
 * Run a single iteration of the Ralph loop
 */
const runIteration = (
  state: LoopState,
  config: LoopConfig
): Effect.Effect<LoopState, LoopError | CircuitBreakerError | UserStopError> =>
  Effect.gen(function* () {
    const step = getCurrentStep(state.plan)

    if (!step) {
      // No more steps - we're done
      return state
    }

    const iteration = state.iteration + 1
    const startTime = Date.now()

    // Emit iteration start
    config.events.emit(iterationStart(iteration, step))

    // Update step status
    let plan = updateStep(state.plan, step.id, { status: "in_progress" })

    // Execute the step
    const context: ExecutionContext = {
      plan,
      iteration,
    }

    const result = yield* config.executor.execute(step, context)

    // Verify the step
    const verification = yield* config.verifier.verify(step)

    const duration = Date.now() - startTime

    if (verification.passed) {
      // Step completed successfully
      plan = updateStep(plan, step.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      config.events.emit(iterationEnd(iteration, step, true, duration))

      return {
        ...state,
        plan,
        iteration,
        noChangeCount: 0, // Reset on success
      }
    } else {
      // Step failed - increment attempts
      const attempts = (step.attempts || 0) + 1
      plan = updateStep(plan, step.id, {
        status: attempts >= 3 ? "failed" : "pending",
        attempts,
        lastError: verification.message,
      })
      config.events.emit(iterationEnd(iteration, step, false, duration))

      // Check circuit breaker
      const noChangeCount = result.changes.length === 0 
        ? state.noChangeCount + 1 
        : 0

      if (noChangeCount >= config.maxNoChange) {
        return yield* Effect.fail(new CircuitBreakerError({
          message: `No progress after ${noChangeCount} iterations`,
          noChangeCount,
        }))
      }

      return {
        ...state,
        plan,
        iteration,
        noChangeCount,
      }
    }
  })

/**
 * Handle hand-crank mode interaction
 */
const handleCrank = (
  config: LoopConfig
): Effect.Effect<boolean, UserStopError> =>
  Effect.gen(function* () {
    if (!config.crankMode || !config.onCrank) {
      return true // Continue in non-crank mode
    }

    const action = yield* config.onCrank()

    switch (action) {
      case "continue":
        return true
      case "review":
        // TODO: Show diff/changes for review
        return true
      case "tune":
        // TODO: Allow prompt tuning
        return true
      case "stop":
        return yield* Effect.fail(new UserStopError({
          message: "User requested stop",
        }))
    }
  })

/**
 * Check if the loop should continue
 */
const shouldContinue = (state: LoopState, config: LoopConfig): boolean => {
  if (state.stopped) return false
  if (state.iteration >= config.maxIterations) return false
  if (isComplete(state.plan)) return false
  if (Date.now() - state.startTime > config.timeoutMs) return false
  return true
}

/**
 * Main Ralph loop
 * 
 * Runs iterations until:
 * - Plan is complete
 * - Max iterations reached
 * - Circuit breaker triggers
 * - User stops (in crank mode)
 * - Timeout
 */
export const runLoop = (
  plan: Plan,
  config: LoopConfig
): Effect.Effect<Plan, LoopError | CircuitBreakerError | UserStopError> =>
  Effect.gen(function* () {
    let state = initialState(plan)

    while (shouldContinue(state, config)) {
      // Run one iteration
      state = yield* runIteration(state, config)

      // Handle hand-crank if enabled
      if (config.crankMode && !isComplete(state.plan)) {
        const shouldContinue = yield* handleCrank(config)
        if (!shouldContinue) {
          state = { ...state, stopped: true }
        }
      }
    }

    return state.plan
  })

/**
 * Run a single iteration (for hand-cranking)
 */
export const runSingleIteration = (
  plan: Plan,
  config: Omit<LoopConfig, "crankMode" | "onCrank">
): Effect.Effect<Plan, LoopError | CircuitBreakerError | UserStopError> =>
  Effect.gen(function* () {
    const state = initialState(plan)
    const newState = yield* runIteration(state, { ...config, crankMode: false })
    return newState.plan
  })

/**
 * Stream events from the loop
 */
export const streamLoop = (
  plan: Plan,
  config: LoopConfig
): Stream.Stream<RalphEvent, LoopError | CircuitBreakerError | UserStopError> =>
  Stream.async((emit) => {
    const unsubscribe = config.events.on((event) => {
      emit.single(event)
    })

    Effect.runPromise(
      runLoop(plan, config).pipe(
        Effect.tap(() => Effect.sync(() => emit.end())),
        Effect.catchAll((e) => Effect.sync(() => emit.fail(e)))
      )
    )

    return Effect.sync(unsubscribe)
  })
