import { readAttributeInteger } from "../attributes"
import type { GraphDefinition, GraphNode } from "../types"

export interface BackoffConfig {
  readonly initialDelayMs: number
  readonly backoffFactor: number
  readonly maxDelayMs: number
  readonly jitter: boolean
}

export interface RetryPolicy {
  readonly maxAttempts: number
  readonly backoff: BackoffConfig
}

const DEFAULT_BACKOFF: BackoffConfig = {
  initialDelayMs: 200,
  backoffFactor: 2,
  maxDelayMs: 60_000,
  jitter: true,
}

export const buildRetryPolicy = (
  node: GraphNode,
  graph: GraphDefinition,
  backoffOverrides: Partial<BackoffConfig> = {},
): RetryPolicy => {
  const hasNodeMaxRetries = Object.prototype.hasOwnProperty.call(node.attrs, "max_retries")
  const nodeRetries = readAttributeInteger(node.attrs, "max_retries", 0)
  const graphDefaultRetries = readAttributeInteger(graph.attrs, "default_max_retry", 0)
  const maxRetries = hasNodeMaxRetries ? nodeRetries : graphDefaultRetries

  return {
    maxAttempts: Math.max(maxRetries + 1, 1),
    backoff: {
      ...DEFAULT_BACKOFF,
      ...backoffOverrides,
    },
  }
}

export const delayForAttempt = (
  attempt: number,
  backoff: BackoffConfig,
  random: () => number = Math.random,
): number => {
  const exponent = Math.max(attempt - 1, 0)
  const rawDelay = backoff.initialDelayMs * backoff.backoffFactor ** exponent
  const boundedDelay = Math.min(rawDelay, backoff.maxDelayMs)

  if (!backoff.jitter) {
    return Math.max(Math.round(boundedDelay), 0)
  }

  const jitterMultiplier = 0.5 + random()
  return Math.max(Math.round(boundedDelay * jitterMultiplier), 0)
}
