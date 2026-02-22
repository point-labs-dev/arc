export type AttributeType = "string" | "integer" | "float" | "boolean" | "duration"

export type DurationUnit = "ms" | "s" | "m" | "h" | "d"

export interface DurationValue {
  readonly raw: string
  readonly amount: number
  readonly unit: DurationUnit
  readonly milliseconds: number
}

export type AttributeValue = string | number | boolean | DurationValue
export type AttributeMap = Record<string, AttributeValue>

export interface GraphNode {
  readonly id: string
  attrs: AttributeMap
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly attrs: AttributeMap
}

export interface GraphDefinition {
  readonly id: string
  readonly attrs: AttributeMap
  readonly nodes: GraphNode[]
  readonly edges: GraphEdge[]
}

export const GRAPH_DEFAULTS: AttributeMap = {
  goal: "",
  label: "",
  model_stylesheet: "",
  default_max_retry: 50,
  retry_target: "",
  fallback_retry_target: "",
  default_fidelity: "",
}

export const NODE_DEFAULTS: AttributeMap = {
  shape: "box",
  type: "",
  prompt: "",
  max_retries: 0,
  goal_gate: false,
  retry_target: "",
  fallback_retry_target: "",
  fidelity: "",
  thread_id: "",
  class: "",
  llm_model: "",
  llm_provider: "",
  reasoning_effort: "high",
  auto_status: false,
  allow_partial: false,
}

export const EDGE_DEFAULTS: AttributeMap = {
  label: "",
  condition: "",
  weight: 0,
  fidelity: "",
  thread_id: "",
  loop_restart: false,
}

export const GRAPH_ATTR_TYPES: Record<string, AttributeType> = {
  goal: "string",
  label: "string",
  model_stylesheet: "string",
  default_max_retry: "integer",
  retry_target: "string",
  fallback_retry_target: "string",
  default_fidelity: "string",
}

export const NODE_ATTR_TYPES: Record<string, AttributeType> = {
  label: "string",
  shape: "string",
  type: "string",
  prompt: "string",
  max_retries: "integer",
  goal_gate: "boolean",
  retry_target: "string",
  fallback_retry_target: "string",
  fidelity: "string",
  thread_id: "string",
  class: "string",
  timeout: "duration",
  llm_model: "string",
  llm_provider: "string",
  reasoning_effort: "string",
  auto_status: "boolean",
  allow_partial: "boolean",
}

export const EDGE_ATTR_TYPES: Record<string, AttributeType> = {
  label: "string",
  condition: "string",
  weight: "integer",
  fidelity: "string",
  thread_id: "string",
  loop_restart: "boolean",
}

export const SHAPE_TO_HANDLER: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
}

export const KNOWN_HANDLER_TYPES = new Set<string>(Object.values(SHAPE_TO_HANDLER))

export const VALID_FIDELITY_MODES = new Set<string>([
  "full",
  "truncate",
  "compact",
  "summary:low",
  "summary:medium",
  "summary:high",
])

export type DiagnosticSeverity = "ERROR" | "WARNING" | "INFO"

export interface Diagnostic {
  readonly rule: string
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly node_id?: string
  readonly edge?: [string, string]
  readonly fix?: string
}

export interface LintRule {
  readonly name: string
  apply(graph: GraphDefinition): Diagnostic[]
}

export class ParseError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(message)
    this.name = "ParseError"
    this.line = line
    this.column = column
  }
}

export class ValidationError extends Error {
  readonly diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    const message = diagnostics
      .map((diagnostic) => `${diagnostic.rule}: ${diagnostic.message}`)
      .join("\n")
    super(`Validation failed:\n${message}`)
    this.name = "ValidationError"
    this.diagnostics = diagnostics
  }
}
