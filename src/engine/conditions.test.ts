import { describe, expect, it } from "vitest"

import { evaluateCondition, resolveConditionKey } from "./context/conditions"
import { PipelineContext } from "./context/context"
import { successOutcome } from "./context/outcome"

describe("evaluateCondition", () => {
  it("returns true for empty conditions", () => {
    const context = new PipelineContext()
    const result = evaluateCondition("", successOutcome(), context)
    expect(result).toBe(true)
  })

  it("evaluates outcome, preferred_label, and context keys", () => {
    const context = new PipelineContext({
      "context.tests_passed": true,
      retry_count: 2,
    })

    const result = evaluateCondition(
      'outcome=success && preferred_label="Ship" && context.tests_passed=true && context.retry_count=2',
      successOutcome({ preferred_label: "Ship" }),
      context,
    )

    expect(result).toBe(true)
  })

  it("treats missing context keys as empty string", () => {
    const context = new PipelineContext()
    const condition = 'context.missing="" && context.missing!=value'
    const result = evaluateCondition(condition, successOutcome(), context)
    expect(result).toBe(true)
  })

  it("resolves context.* keys with and without the prefix", () => {
    const context = new PipelineContext({
      "context.alpha": "A",
      beta: "B",
    })

    const resolvedAlpha = resolveConditionKey("context.alpha", successOutcome(), context)
    const resolvedBeta = resolveConditionKey("context.beta", successOutcome(), context)

    expect(resolvedAlpha).toBe("A")
    expect(resolvedBeta).toBe("B")
  })
})
