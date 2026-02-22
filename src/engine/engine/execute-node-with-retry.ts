import { readAttributeBoolean } from "../attributes"
import type { PipelineContext } from "../context/context"
import { type Outcome, failOutcome, normalizeOutcome } from "../context/outcome"
import type { PipelineEventEmitter } from "../events/emitter"
import type { PipelineEvent } from "../events/events"
import type { Handler } from "../handlers/handler"
import type { GraphDefinition, GraphNode } from "../types"
import { type BackoffConfig, type RetryPolicy, buildRetryPolicy, delayForAttempt } from "./retry"

export interface ExecuteNodeWithRetryInput {
  readonly graph: GraphDefinition
  readonly node: GraphNode
  readonly handler: Handler
  readonly context: PipelineContext
  readonly logsRoot?: string
  readonly retryPolicy?: RetryPolicy
  readonly retryBackoff?: Partial<BackoffConfig>
  readonly nodeRetries?: Record<string, number>
  readonly emitter?: PipelineEventEmitter
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly random?: () => number
}

export const executeNodeWithRetry = async (
  input: ExecuteNodeWithRetryInput,
): Promise<Outcome> => {
  const retryPolicy =
    input.retryPolicy ?? buildRetryPolicy(input.node, input.graph, input.retryBackoff)
  const allowPartial = readAttributeBoolean(input.node.attrs, "allow_partial", false)

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    const attemptStartedAt = Date.now()

    await emitEvent(input.emitter, {
      type: "stage_started",
      node_id: input.node.id,
      attempt,
    })

    let outcome: Outcome
    try {
      outcome = normalizeOutcome(
        await input.handler.execute(input.node, input.context, input.graph, input.logsRoot),
      )
    } catch (error) {
      outcome = failOutcome(error instanceof Error ? error.message : String(error))
    }

    const durationMs = Date.now() - attemptStartedAt
    const canRetry = attempt < retryPolicy.maxAttempts

    if (
      outcome.status === "success" ||
      outcome.status === "partial_success" ||
      outcome.status === "skipped"
    ) {
      if (input.nodeRetries !== undefined) {
        delete input.nodeRetries[input.node.id]
      }
      input.context.set(`internal.retry_count.${input.node.id}`, 0)

      await emitEvent(input.emitter, {
        type: "stage_completed",
        node_id: input.node.id,
        attempt,
        duration_ms: durationMs,
        status: outcome.status,
      })

      return outcome
    }

    if ((outcome.status === "retry" || outcome.status === "fail") && canRetry) {
      if (input.nodeRetries !== undefined) {
        input.nodeRetries[input.node.id] = attempt
      }
      input.context.set(`internal.retry_count.${input.node.id}`, attempt)

      await emitEvent(input.emitter, {
        type: "stage_failed",
        node_id: input.node.id,
        attempt,
        duration_ms: durationMs,
        error: outcome.failure_reason,
        will_retry: true,
      })

      const delayMs = delayForAttempt(attempt, retryPolicy.backoff, input.random)
      await emitEvent(input.emitter, {
        type: "stage_retrying",
        node_id: input.node.id,
        attempt,
        delay_ms: delayMs,
      })
      await (input.sleep ?? sleep)(delayMs)

      continue
    }

    if (outcome.status === "retry" && allowPartial) {
      const partialOutcome = normalizeOutcome({
        status: "partial_success",
        notes: "Retries exhausted, partial accepted",
        context_updates: outcome.context_updates,
      })

      await emitEvent(input.emitter, {
        type: "stage_completed",
        node_id: input.node.id,
        attempt,
        duration_ms: durationMs,
        status: partialOutcome.status,
      })

      return partialOutcome
    }

    await emitEvent(input.emitter, {
      type: "stage_failed",
      node_id: input.node.id,
      attempt,
      duration_ms: durationMs,
      error: outcome.failure_reason,
      will_retry: false,
    })

    return outcome.status === "retry"
      ? failOutcome(outcome.failure_reason || "max retries exceeded")
      : outcome
  }

  return failOutcome("max retries exceeded")
}

const sleep = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

const emitEvent = async (
  emitter: PipelineEventEmitter | undefined,
  event: PipelineEvent,
): Promise<void> => {
  if (emitter === undefined) {
    return
  }

  await emitter.emit(event)
}
