import { exec } from "node:child_process"
import { promisify } from "node:util"

import type { HoldoutRunResult } from "./scenarios"

const execAsync = promisify(exec)

export const DEFAULT_SATISFACTION_THRESHOLD = 0.8

export interface SatisfactionInput {
  readonly spec_text: string
  readonly implementation_summary: string
  readonly standard_verification_passed: boolean
  readonly holdout: Pick<HoldoutRunResult, "passed" | "scenario_count" | "failed_scenario_ids">
}

export interface SatisfactionJudgement {
  readonly score: number
  readonly rationale: string
}

export interface SatisfactionJudge {
  judge(input: SatisfactionInput): Promise<SatisfactionJudgement> | SatisfactionJudgement
}

export interface SatisfactionLlmClient {
  complete(prompt: string): Promise<string> | string
}

export interface LlmSatisfactionJudgeOptions {
  readonly llm: SatisfactionLlmClient
  readonly prompt_instructions?: string
}

export interface CommandSatisfactionLlmClientOptions {
  readonly command: string
  readonly cwd?: string
  readonly timeout_ms?: number
  readonly max_buffer_bytes?: number
  readonly env?: Readonly<Record<string, string>>
}

export interface CommandSatisfactionJudgeOptions extends CommandSatisfactionLlmClientOptions {
  readonly prompt_instructions?: string
}

export interface SatisfactionResult {
  readonly score: number
  readonly threshold: number
  readonly passed: boolean
  readonly rationale: string
}

export interface SatisfactionEvent {
  readonly type: "satisfaction_score"
  readonly score: number
  readonly threshold: number
  readonly passed: boolean
  readonly rationale: string
}

export interface EvaluateSatisfactionOptions {
  readonly input: SatisfactionInput
  readonly threshold?: number
  readonly judge?: SatisfactionJudge
  readonly on_event?: (event: SatisfactionEvent) => Promise<void> | void
}

export class SatisfactionJudgeError extends Error {
  readonly response_preview?: string

  constructor(
    message: string,
    options: {
      readonly response_text?: string
    } = {},
  ) {
    super(message)
    this.name = "SatisfactionJudgeError"
    this.response_preview =
      options.response_text === undefined ? undefined : truncate(options.response_text, 500)
  }
}

export class SatisfactionConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SatisfactionConfigurationError"
  }
}

export const evaluateSatisfaction = async (
  options: EvaluateSatisfactionOptions,
): Promise<SatisfactionResult> => {
  const threshold = clampToUnitInterval(options.threshold ?? DEFAULT_SATISFACTION_THRESHOLD)
  const judge = options.judge ?? heuristicSatisfactionJudge
  const judgement = await judge.judge(options.input)
  const score = clampToUnitInterval(judgement.score)
  const result: SatisfactionResult = {
    score,
    threshold,
    passed: score >= threshold,
    rationale: judgement.rationale,
  }

  if (options.on_event !== undefined) {
    await options.on_event({
      type: "satisfaction_score",
      score: result.score,
      threshold: result.threshold,
      passed: result.passed,
      rationale: result.rationale,
    })
  }

  return result
}

export const createLlmSatisfactionJudge = (
  options: LlmSatisfactionJudgeOptions,
): SatisfactionJudge => ({
  async judge(input) {
    const prompt = buildSatisfactionPrompt(input, options.prompt_instructions)
    let response: string
    try {
      response = await options.llm.complete(prompt)
    } catch (error) {
      throw new SatisfactionJudgeError(
        `LLM judge request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return parseLlmJudgement(response)
  },
})

export const createCommandSatisfactionLlmClient = (
  options: CommandSatisfactionLlmClientOptions,
): SatisfactionLlmClient => {
  const command = options.command.trim()
  if (command.length === 0) {
    throw new SatisfactionConfigurationError(
      "Satisfaction command client requires a non-empty command",
    )
  }

  const maxBufferBytes = options.max_buffer_bytes ?? DEFAULT_COMMAND_MAX_BUFFER_BYTES

  return {
    async complete(prompt) {
      const commandEnv = buildSatisfactionEnvironment(prompt)
      try {
        const result = await execAsync(command, {
          cwd: options.cwd,
          timeout: options.timeout_ms,
          maxBuffer: maxBufferBytes,
          env: {
            ...process.env,
            ...options.env,
            ...commandEnv,
          },
        })
        return result.stdout
      } catch (error) {
        if (!isExecError(error)) {
          throw error
        }

        const code = typeof error.code === "number" ? error.code : 1
        const stderr = error.stderr ?? ""
        const stdout = error.stdout ?? ""

        throw new SatisfactionJudgeError(`Satisfaction command failed with exit code ${code}`, {
          response_text: `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
        })
      }
    },
  }
}

export const createCommandSatisfactionJudge = (
  options: CommandSatisfactionJudgeOptions,
): SatisfactionJudge =>
  createLlmSatisfactionJudge({
    llm: createCommandSatisfactionLlmClient(options),
    prompt_instructions: options.prompt_instructions,
  })

export const heuristicSatisfactionJudge: SatisfactionJudge = {
  judge(input): SatisfactionJudgement {
    const coverage = computeKeywordCoverage(input.spec_text, input.implementation_summary)
    const verificationBonus = input.standard_verification_passed ? 0.15 : 0
    const holdoutBonus = input.holdout.passed && input.holdout.scenario_count > 0 ? 0.15 : 0
    const score = clampToUnitInterval(coverage * 0.7 + verificationBonus + holdoutBonus)

    const failedScenarios =
      input.holdout.failed_scenario_ids.length > 0
        ? `Failed holdouts: ${input.holdout.failed_scenario_ids.join(", ")}.`
        : "No holdout failures detected."
    const rationale = `Coverage ${(coverage * 100).toFixed(
      1,
    )}%. Standard verification ${input.standard_verification_passed ? "passed" : "failed"}. ${failedScenarios}`

    return {
      score,
      rationale,
    }
  },
}

const computeKeywordCoverage = (specText: string, implementationSummary: string): number => {
  const specKeywords = toKeywordSet(specText)
  if (specKeywords.size === 0) {
    return implementationSummary.trim().length > 0 ? 1 : 0
  }

  const implementationKeywords = toKeywordSet(implementationSummary)
  let matched = 0
  for (const keyword of specKeywords) {
    if (implementationKeywords.has(keyword)) {
      matched += 1
    }
  }

  return matched / specKeywords.size
}

const toKeywordSet = (value: string): Set<string> => {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))

  return new Set(words)
}

const clampToUnitInterval = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

const buildSatisfactionPrompt = (
  input: SatisfactionInput,
  promptInstructions: string | undefined,
): string => {
  const instructionText = promptInstructions?.trim()
  const instructionBlock =
    instructionText === undefined || instructionText.length === 0
      ? ""
      : `Additional instructions:\n${instructionText}\n\n`

  return [
    "You are an impartial software verification judge.",
    "Evaluate whether the implementation satisfies the specification based on the provided evidence.",
    'Return ONLY valid JSON with shape {"score": number, "rationale": string}.',
    "Score must be between 0 and 1 where 1 means fully satisfies the specification.",
    instructionBlock,
    "Input:",
    JSON.stringify(input, null, 2),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
}

const parseLlmJudgement = (response: string): SatisfactionJudgement => {
  const jsonPayload = extractJsonPayload(response)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonPayload)
  } catch (error) {
    throw new SatisfactionJudgeError(
      `LLM judge response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { response_text: response },
    )
  }

  if (!isRecord(parsed)) {
    throw new SatisfactionJudgeError("LLM judge response must be a JSON object", {
      response_text: response,
    })
  }

  const score = parsed.score
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new SatisfactionJudgeError('LLM judge response must include numeric "score"', {
      response_text: response,
    })
  }

  const rationale = parsed.rationale
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    throw new SatisfactionJudgeError('LLM judge response must include non-empty "rationale"', {
      response_text: response,
    })
  }

  return {
    score,
    rationale: rationale.trim(),
  }
}

const extractJsonPayload = (response: string): string => {
  const trimmed = response.trim()
  if (trimmed.length === 0) {
    throw new SatisfactionJudgeError("LLM judge response is empty")
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch !== null && fencedMatch[1] !== undefined) {
    const fenced = fencedMatch[1].trim()
    if (fenced.length > 0) {
      return fenced
    }
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  throw new SatisfactionJudgeError("LLM judge response did not contain a JSON object", {
    response_text: response,
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const buildSatisfactionEnvironment = (prompt: string): Record<string, string> => ({
  ARC_SATISFACTION_PROMPT: prompt,
  ARC_SATISFACTION_PROMPT_BASE64: Buffer.from(prompt, "utf8").toString("base64"),
})

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`

const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024

const STOP_WORDS = new Set<string>([
  "about",
  "after",
  "again",
  "also",
  "been",
  "before",
  "being",
  "between",
  "from",
  "have",
  "into",
  "just",
  "more",
  "over",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "when",
  "where",
  "while",
  "with",
])
