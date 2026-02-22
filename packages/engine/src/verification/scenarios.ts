import { exec } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { promisify } from "node:util"

const execAsync = promisify(exec)

export interface HoldoutScenario {
  readonly id: string
  readonly name: string
  readonly setup: readonly string[]
  readonly steps: readonly string[]
  readonly expected: readonly string[]
  readonly source_path: string
}

export interface HoldoutEvaluation {
  readonly passed: boolean
  readonly summary?: string
  readonly details?: string
}

export interface HoldoutScenarioResult extends HoldoutEvaluation {
  readonly scenario_id: string
  readonly scenario_name: string
  readonly duration_ms: number
  readonly error?: string
}

export interface HoldoutScenarioEvaluator {
  evaluate(scenario: HoldoutScenario): Promise<HoldoutEvaluation> | HoldoutEvaluation
}

export interface HoldoutScenarioExecution {
  readonly command: string
  readonly exit_code: number
  readonly stdout: string
  readonly stderr: string
}

export interface HoldoutScenarioExecutor {
  execute(scenario: HoldoutScenario): Promise<HoldoutScenarioExecution> | HoldoutScenarioExecution
}

export interface CommandHoldoutExecutorOptions {
  readonly command: string
  readonly cwd?: string
  readonly timeout_ms?: number
  readonly max_buffer_bytes?: number
  readonly env?: Readonly<Record<string, string>>
}

export interface ExecutorBackedHoldoutEvaluatorOptions {
  readonly output_limit_chars?: number
}

export type HoldoutEvent =
  | {
      readonly type: "holdout_start"
      readonly scenario_count: number
      readonly started_at: string
    }
  | {
      readonly type: "holdout_scenario_start"
      readonly scenario_id: string
      readonly scenario_name: string
    }
  | {
      readonly type: "holdout_scenario_end"
      readonly scenario_id: string
      readonly scenario_name: string
      readonly passed: boolean
      readonly duration_ms: number
      readonly error?: string
    }
  | {
      readonly type: "holdout_end"
      readonly scenario_count: number
      readonly passed: boolean
      readonly duration_ms: number
      readonly failed_scenario_ids: readonly string[]
    }

interface RunHoldoutScenariosSharedOptions {
  readonly scenarios_root: string
  readonly require_scenarios?: boolean
  readonly fail_fast?: boolean
  readonly on_event?: (event: HoldoutEvent) => Promise<void> | void
}

interface RunHoldoutScenariosWithEvaluator extends RunHoldoutScenariosSharedOptions {
  readonly evaluator: HoldoutScenarioEvaluator
  readonly executor?: HoldoutScenarioExecutor
}

interface RunHoldoutScenariosWithExecutor extends RunHoldoutScenariosSharedOptions {
  readonly evaluator?: HoldoutScenarioEvaluator
  readonly executor: HoldoutScenarioExecutor
}

export type RunHoldoutScenariosOptions =
  | RunHoldoutScenariosWithEvaluator
  | RunHoldoutScenariosWithExecutor

export interface HoldoutRunResult {
  readonly passed: boolean
  readonly scenario_count: number
  readonly executed_count: number
  readonly scenario_results: readonly HoldoutScenarioResult[]
  readonly failed_scenario_ids: readonly string[]
  readonly duration_ms: number
  readonly failure_reason?: string
}

interface ParseHoldoutScenarioOptions {
  readonly source_path: string
  readonly id?: string
}

type ScenarioSection = "setup" | "steps" | "expected"

const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const DEFAULT_EVALUATION_OUTPUT_LIMIT_CHARS = 32_000

export class HoldoutConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HoldoutConfigurationError"
  }
}

export class ScenarioParseError extends Error {
  constructor(
    message: string,
    readonly source_path: string,
  ) {
    super(`${message} (${source_path})`)
    this.name = "ScenarioParseError"
  }
}

export const createCommandHoldoutExecutor = (
  options: CommandHoldoutExecutorOptions,
): HoldoutScenarioExecutor => {
  const command = options.command.trim()
  if (command.length === 0) {
    throw new HoldoutConfigurationError("Command executor requires a non-empty command")
  }

  const maxBufferBytes = options.max_buffer_bytes ?? DEFAULT_COMMAND_MAX_BUFFER_BYTES

  return {
    async execute(scenario) {
      const scenarioEnv = buildScenarioEnvironment(scenario)

      try {
        const result = await execAsync(command, {
          cwd: options.cwd,
          timeout: options.timeout_ms,
          maxBuffer: maxBufferBytes,
          env: {
            ...process.env,
            ...options.env,
            ...scenarioEnv,
          },
        })

        return {
          command,
          exit_code: 0,
          stdout: result.stdout,
          stderr: result.stderr,
        }
      } catch (error) {
        if (isExecError(error)) {
          return {
            command,
            exit_code: typeof error.code === "number" ? error.code : 1,
            stdout: error.stdout ?? "",
            stderr: error.stderr ?? error.message,
          }
        }
        throw error
      }
    },
  }
}

export const createExecutorBackedHoldoutEvaluator = (
  executor: HoldoutScenarioExecutor,
  options: ExecutorBackedHoldoutEvaluatorOptions = {},
): HoldoutScenarioEvaluator => ({
  async evaluate(scenario) {
    const execution = await executor.execute(scenario)
    const details = formatExecutionDetails(execution, options.output_limit_chars)

    return {
      passed: execution.exit_code === 0,
      summary: `${execution.command} => exit ${execution.exit_code}`,
      details,
    }
  },
})

export const discoverHoldoutScenarioFiles = async (scenariosRoot: string): Promise<string[]> => {
  const files: string[] = []
  await walkDirectory(scenariosRoot, files)
  return files.sort((left, right) => left.localeCompare(right))
}

export const loadHoldoutScenarios = async (scenariosRoot: string): Promise<HoldoutScenario[]> => {
  const files = await discoverHoldoutScenarioFiles(scenariosRoot)
  const scenarios: HoldoutScenario[] = []
  const seenIds = new Set<string>()

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8")
    const scenarioId = pathToScenarioId(relative(scenariosRoot, filePath))
    const scenario = parseHoldoutScenario(content, {
      source_path: filePath,
      id: scenarioId,
    })

    if (seenIds.has(scenario.id)) {
      throw new ScenarioParseError(`Duplicate scenario id "${scenario.id}"`, filePath)
    }
    seenIds.add(scenario.id)
    scenarios.push(scenario)
  }

  return scenarios
}

export const parseHoldoutScenario = (
  markdown: string,
  options: ParseHoldoutScenarioOptions,
): HoldoutScenario => {
  const normalized = markdown.replaceAll("\r\n", "\n")
  const lines = normalized.split("\n")

  let scenarioName = ""
  let currentSection: ScenarioSection | undefined
  const setup: string[] = []
  const steps: string[] = []
  const expected: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }

    if (scenarioName.length === 0) {
      const headerMatch = line.match(/^#\s*Scenario:\s*(.+)$/i)
      if (headerMatch !== null) {
        scenarioName = headerMatch[1].trim()
        continue
      }
    }

    const sectionMatch = line.match(/^##\s*(Setup|Steps|Expected)\s*$/i)
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1].toLowerCase() as ScenarioSection
      continue
    }

    if (currentSection === undefined) {
      continue
    }

    appendSectionLine(line, currentSection, {
      setup,
      steps,
      expected,
    })
  }

  if (scenarioName.length === 0) {
    throw new ScenarioParseError(
      "Scenario title is required (# Scenario: ...)",
      options.source_path,
    )
  }
  if (steps.length === 0) {
    throw new ScenarioParseError("Scenario must define at least one step", options.source_path)
  }
  if (expected.length === 0) {
    throw new ScenarioParseError(
      "Scenario must define at least one expected assertion",
      options.source_path,
    )
  }

  const scenarioId = options.id?.trim() || slugifyScenarioName(scenarioName)
  if (scenarioId.length === 0) {
    throw new ScenarioParseError("Scenario id resolved to an empty value", options.source_path)
  }

  return {
    id: scenarioId,
    name: scenarioName,
    setup,
    steps,
    expected,
    source_path: options.source_path,
  }
}

export const runHoldoutScenarios = async (
  options: RunHoldoutScenariosOptions,
): Promise<HoldoutRunResult> => {
  const evaluator = resolveScenarioEvaluator(options)
  const startedAt = Date.now()
  const scenarios = await loadHoldoutScenarios(options.scenarios_root)
  const requireScenarios = options.require_scenarios ?? true

  await emit(options.on_event, {
    type: "holdout_start",
    scenario_count: scenarios.length,
    started_at: new Date(startedAt).toISOString(),
  })

  if (scenarios.length === 0 && requireScenarios) {
    const durationMs = Date.now() - startedAt
    const result: HoldoutRunResult = {
      passed: false,
      scenario_count: 0,
      executed_count: 0,
      scenario_results: [],
      failed_scenario_ids: [],
      duration_ms: durationMs,
      failure_reason: `No holdout scenarios found in "${options.scenarios_root}"`,
    }

    await emit(options.on_event, {
      type: "holdout_end",
      scenario_count: 0,
      passed: false,
      duration_ms: durationMs,
      failed_scenario_ids: [],
    })

    return result
  }

  const scenarioResults: HoldoutScenarioResult[] = []
  for (const scenario of scenarios) {
    await emit(options.on_event, {
      type: "holdout_scenario_start",
      scenario_id: scenario.id,
      scenario_name: scenario.name,
    })

    const scenarioStartedAt = Date.now()
    let result: HoldoutScenarioResult
    try {
      const evaluation = await evaluator.evaluate(scenario)
      result = {
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        passed: evaluation.passed,
        summary: evaluation.summary,
        details: evaluation.details,
        duration_ms: Date.now() - scenarioStartedAt,
      }
    } catch (error) {
      result = {
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        passed: false,
        details: "Scenario evaluator threw an error",
        duration_ms: Date.now() - scenarioStartedAt,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    scenarioResults.push(result)

    await emit(options.on_event, {
      type: "holdout_scenario_end",
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      passed: result.passed,
      duration_ms: result.duration_ms,
      error: result.error,
    })

    if (!result.passed && options.fail_fast === true) {
      break
    }
  }

  const failedScenarioIds = scenarioResults
    .filter((scenario) => !scenario.passed)
    .map((scenario) => scenario.scenario_id)
  const durationMs = Date.now() - startedAt
  const passed = failedScenarioIds.length === 0 && (!requireScenarios || scenarios.length > 0)

  const runResult: HoldoutRunResult = {
    passed,
    scenario_count: scenarios.length,
    executed_count: scenarioResults.length,
    scenario_results: scenarioResults,
    failed_scenario_ids: failedScenarioIds,
    duration_ms: durationMs,
  }

  await emit(options.on_event, {
    type: "holdout_end",
    scenario_count: scenarios.length,
    passed,
    duration_ms: durationMs,
    failed_scenario_ids: failedScenarioIds,
  })

  return runResult
}

const resolveScenarioEvaluator = (
  options: RunHoldoutScenariosOptions,
): HoldoutScenarioEvaluator => {
  if (options.evaluator !== undefined) {
    return options.evaluator
  }
  if (options.executor !== undefined) {
    return createExecutorBackedHoldoutEvaluator(options.executor)
  }

  throw new HoldoutConfigurationError(
    "runHoldoutScenarios requires either an evaluator or an executor",
  )
}

const buildScenarioEnvironment = (scenario: HoldoutScenario): Record<string, string> => ({
  ARC_HOLDOUT_SCENARIO_ID: scenario.id,
  ARC_HOLDOUT_SCENARIO_NAME: scenario.name,
  ARC_HOLDOUT_SCENARIO_PATH: scenario.source_path,
  ARC_HOLDOUT_SCENARIO_SETUP_JSON: JSON.stringify(scenario.setup),
  ARC_HOLDOUT_SCENARIO_STEPS_JSON: JSON.stringify(scenario.steps),
  ARC_HOLDOUT_SCENARIO_EXPECTED_JSON: JSON.stringify(scenario.expected),
  ARC_HOLDOUT_SCENARIO_JSON: JSON.stringify(scenario),
})

const formatExecutionDetails = (
  execution: HoldoutScenarioExecution,
  outputLimitChars: number | undefined,
): string | undefined => {
  const parts: string[] = []
  const stdout = execution.stdout.trim()
  const stderr = execution.stderr.trim()

  if (stdout.length > 0) {
    parts.push(`stdout:\n${stdout}`)
  }
  if (stderr.length > 0) {
    parts.push(`stderr:\n${stderr}`)
  }

  if (parts.length === 0) {
    return undefined
  }

  const merged = parts.join("\n\n")
  const maxChars = resolveOutputLimitChars(outputLimitChars)
  if (merged.length <= maxChars) {
    return merged
  }

  const truncated = merged.slice(0, maxChars)
  const hiddenChars = merged.length - maxChars
  return `${truncated}\n...[truncated ${hiddenChars} chars]`
}

const resolveOutputLimitChars = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_EVALUATION_OUTPUT_LIMIT_CHARS
  }
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_EVALUATION_OUTPUT_LIMIT_CHARS
  }

  return Math.floor(value)
}

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value

const walkDirectory = async (dirPath: string, files: string[]): Promise<void> => {
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(entryPath, files)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (entry.name.endsWith(".scenario.md")) {
      files.push(entryPath)
    }
  }
}

const appendSectionLine = (
  line: string,
  section: ScenarioSection,
  sections: {
    setup: string[]
    steps: string[]
    expected: string[]
  },
): void => {
  const normalizedLine = normalizeListLine(line)
  if (normalizedLine.length === 0) {
    return
  }

  if (section === "setup") {
    sections.setup.push(normalizedLine)
    return
  }
  if (section === "steps") {
    sections.steps.push(normalizedLine)
    return
  }
  sections.expected.push(normalizedLine)
}

const normalizeListLine = (line: string): string => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return ""
  }

  const withoutCheckbox = trimmed.replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
  const withoutNumber = withoutCheckbox.replace(/^\d+[.)]\s+/, "")
  return withoutNumber.replace(/^[-*+]\s+/, "").trim()
}

const pathToScenarioId = (pathFromRoot: string): string => {
  const withoutSuffix = pathFromRoot.replace(/\.scenario\.md$/i, "")
  return slugifyScenarioName(withoutSuffix.replaceAll("/", "-").replaceAll("\\", "-"))
}

const slugifyScenarioName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "")

const emit = async (
  handler: ((event: HoldoutEvent) => Promise<void> | void) | undefined,
  event: HoldoutEvent,
): Promise<void> => {
  if (handler === undefined) {
    return
  }
  await handler(event)
}
