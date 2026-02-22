import { type Outcome, failOutcome, normalizeOutcome } from "../context/outcome"

export interface ParallelBranchResult {
  readonly branch_id: string
  readonly start_node_id: string
  readonly terminal_node_id: string
  readonly completed_nodes: string[]
  readonly outcome: Outcome
  readonly score: number
}

export const normalizeParallelBranchResults = (value: unknown): ParallelBranchResult[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: ParallelBranchResult[] = []
  for (const item of value) {
    const candidate = normalizeParallelBranchResult(item)
    if (candidate !== undefined) {
      normalized.push(candidate)
    }
  }
  return normalized
}

const normalizeParallelBranchResult = (value: unknown): ParallelBranchResult | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined
  }

  const branchId = valueAt(value, "branch_id")
  const startNodeId = valueAt(value, "start_node_id")
  const terminalNodeId = valueAt(value, "terminal_node_id")
  const completedNodes = normalizeStringList(valueAt(value, "completed_nodes"))
  const rawOutcome = valueAt(value, "outcome")
  const rawScore = valueAt(value, "score")

  if (
    typeof branchId !== "string" ||
    branchId.trim().length === 0 ||
    typeof startNodeId !== "string" ||
    startNodeId.trim().length === 0 ||
    typeof terminalNodeId !== "string" ||
    terminalNodeId.trim().length === 0
  ) {
    return undefined
  }

  const outcome =
    typeof rawOutcome === "object" && rawOutcome !== null
      ? normalizeOutcome(rawOutcome)
      : failOutcome("Missing branch outcome")

  return {
    branch_id: branchId,
    start_node_id: startNodeId,
    terminal_node_id: terminalNodeId,
    completed_nodes: completedNodes,
    outcome,
    score: toFiniteNumber(rawScore, 0),
  }
}

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}

const valueAt = (value: object, key: string): unknown => value[key as keyof typeof value] as unknown

const toFiniteNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}
