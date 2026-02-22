import { type ParsedConditionClause, parseConditionExpression } from "../validation"
import { PipelineContext } from "./context"
import type { Outcome } from "./outcome"

export const evaluateCondition = (
  condition: string,
  outcome: Outcome,
  context: PipelineContext | Record<string, unknown>,
): boolean => {
  const trimmed = condition.trim()
  if (trimmed.length === 0) {
    return true
  }

  const clauses = parseConditionExpression(trimmed)
  for (const clause of clauses) {
    if (!evaluateClause(clause, outcome, context)) {
      return false
    }
  }

  return true
}

export const resolveConditionKey = (
  key: string,
  outcome: Outcome,
  context: PipelineContext | Record<string, unknown>,
): string => {
  if (key === "outcome") {
    return outcome.status
  }

  if (key === "preferred_label") {
    return outcome.preferred_label
  }

  if (key.startsWith("context.")) {
    const prefixed = lookupContextValue(context, key)
    if (prefixed !== undefined) {
      return asComparableString(prefixed)
    }

    const stripped = lookupContextValue(context, key.slice("context.".length))
    if (stripped !== undefined) {
      return asComparableString(stripped)
    }

    return ""
  }

  const direct = lookupContextValue(context, key)
  if (direct !== undefined) {
    return asComparableString(direct)
  }

  return ""
}

const evaluateClause = (
  clause: ParsedConditionClause,
  outcome: Outcome,
  context: PipelineContext | Record<string, unknown>,
): boolean => {
  const actual = resolveConditionKey(clause.key, outcome, context)
  const expected = asComparableString(clause.literal)

  if (clause.operator === "=") {
    return actual === expected
  }
  return actual !== expected
}

const lookupContextValue = (
  context: PipelineContext | Record<string, unknown>,
  key: string,
): unknown => {
  if (context instanceof PipelineContext) {
    return context.get(key)
  }
  return context[key]
}

const asComparableString = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (value === undefined || value === null) {
    return ""
  }
  return String(value)
}
