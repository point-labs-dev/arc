import { describe, expect, it } from "vitest"

import {
  SatisfactionConfigurationError,
  type SatisfactionEvent,
  type SatisfactionJudge,
  SatisfactionJudgeError,
  createCommandSatisfactionJudge,
  createCommandSatisfactionLlmClient,
  createLlmSatisfactionJudge,
  evaluateSatisfaction,
  heuristicSatisfactionJudge,
} from "./satisfaction"

describe("evaluateSatisfaction", () => {
  const input = {
    spec_text: "Implement login, profile retrieval, and proper error handling",
    implementation_summary: "Login and profile retrieval implemented with robust error handling",
    standard_verification_passed: true,
    holdout: {
      passed: true,
      scenario_count: 2,
      failed_scenario_ids: [],
    },
  } as const

  it("clamps score and threshold to 0..1", async () => {
    const judge: SatisfactionJudge = {
      judge: () => ({
        score: 4.2,
        rationale: "overconfident",
      }),
    }

    const result = await evaluateSatisfaction({
      input,
      threshold: 2.5,
      judge,
    })

    expect(result.score).toBe(1)
    expect(result.threshold).toBe(1)
    expect(result.passed).toBe(true)
  })

  it("emits satisfaction_score events", async () => {
    const events: SatisfactionEvent[] = []
    const result = await evaluateSatisfaction({
      input,
      judge: {
        judge: () => ({
          score: 0.79,
          rationale: "almost there",
        }),
      },
      threshold: 0.8,
      on_event: (event) => {
        events.push(event)
      },
    })

    expect(result.passed).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "satisfaction_score",
      score: 0.79,
      threshold: 0.8,
      passed: false,
      rationale: "almost there",
    })
  })

  it("heuristic judge rewards verification and holdout success", () => {
    const strong = heuristicSatisfactionJudge.judge(input)
    const weak = heuristicSatisfactionJudge.judge({
      ...input,
      standard_verification_passed: false,
      holdout: {
        passed: false,
        scenario_count: 2,
        failed_scenario_ids: ["auth-flow"],
      },
    })

    expect(strong.score).toBeGreaterThan(weak.score)
    expect(strong.rationale).toContain("Standard verification passed")
    expect(weak.rationale).toContain("Failed holdouts")
  })

  it("llm judge parses structured JSON responses", async () => {
    let capturedPrompt = ""
    const llmJudge = createLlmSatisfactionJudge({
      llm: {
        complete: async (prompt) => {
          capturedPrompt = prompt
          return JSON.stringify({
            score: 0.91,
            rationale: "Implementation satisfies the specification and verification evidence.",
          })
        },
      },
    })

    const judgement = await llmJudge.judge(input)
    expect(judgement).toEqual({
      score: 0.91,
      rationale: "Implementation satisfies the specification and verification evidence.",
    })
    expect(capturedPrompt).toContain(input.spec_text)
    expect(capturedPrompt).toContain(input.implementation_summary)
  })

  it("llm judge accepts JSON inside markdown fences", async () => {
    const llmJudge = createLlmSatisfactionJudge({
      llm: {
        complete: () =>
          'analysis:\n```json\n{"score":0.67,"rationale":"Most requirements are met but one holdout remains."}\n```',
      },
    })

    const judgement = await llmJudge.judge(input)
    expect(judgement.score).toBe(0.67)
    expect(judgement.rationale).toContain("holdout")
  })

  it("llm judge throws a typed error when response is malformed", async () => {
    const llmJudge = createLlmSatisfactionJudge({
      llm: {
        complete: () => "score=1 rationale=done",
      },
    })

    await expect(llmJudge.judge(input)).rejects.toThrow(SatisfactionJudgeError)
  })

  it("command-backed judge evaluates with runtime command", async () => {
    const judge = createCommandSatisfactionJudge({
      command:
        'node -e "const prompt = process.env.ARC_SATISFACTION_PROMPT ?? \'\'; process.stdout.write(prompt.includes(\'proper error handling\') ? \'{\\"score\\":0.88,\\"rationale\\":\\"Runtime judge validated the evidence.\\"}\' : \'{\\"score\\":0.2,\\"rationale\\":\\"Prompt missing key requirement.\\"}\')"',
    })

    const result = await evaluateSatisfaction({
      input,
      judge,
      threshold: 0.8,
    })

    expect(result.passed).toBe(true)
    expect(result.score).toBe(0.88)
    expect(result.rationale).toContain("Runtime judge")
  })

  it("command-backed client throws typed error on failed runtime command", async () => {
    const client = createCommandSatisfactionLlmClient({
      command: "node -e \"process.stderr.write('runtime failure'); process.exit(7)\"",
    })

    await expect(client.complete("prompt")).rejects.toThrow(SatisfactionJudgeError)
  })

  it("rejects command-backed client with an empty command", () => {
    expect(() => createCommandSatisfactionLlmClient({ command: "  " })).toThrow(
      SatisfactionConfigurationError,
    )
  })
})
