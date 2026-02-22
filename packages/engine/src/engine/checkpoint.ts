import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Outcome } from "../context/outcome"

export interface PipelineCheckpoint {
  readonly timestamp: string
  readonly current_node: string
  readonly completed_nodes: string[]
  readonly node_retries: Record<string, number>
  readonly context_values: Record<string, unknown>
  readonly logs: string[]
  readonly node_outcomes: Record<string, Outcome>
}

export const createCheckpoint = (input: {
  currentNode: string
  completedNodes: string[]
  nodeRetries: Record<string, number>
  contextValues: Record<string, unknown>
  logs: string[]
  nodeOutcomes: Record<string, Outcome>
}): PipelineCheckpoint => ({
  timestamp: new Date().toISOString(),
  current_node: input.currentNode,
  completed_nodes: [...input.completedNodes],
  node_retries: { ...input.nodeRetries },
  context_values: { ...input.contextValues },
  logs: [...input.logs],
  node_outcomes: { ...input.nodeOutcomes },
})

export const saveCheckpoint = async (
  path: string,
  checkpoint: PipelineCheckpoint,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(checkpoint, null, 2), "utf8")
}

export const loadCheckpoint = async (path: string): Promise<PipelineCheckpoint> => {
  const contents = await readFile(path, "utf8")
  const parsed = JSON.parse(contents) as Partial<PipelineCheckpoint>

  if (
    typeof parsed.current_node !== "string" ||
    !Array.isArray(parsed.completed_nodes) ||
    typeof parsed.node_retries !== "object" ||
    parsed.node_retries === null ||
    typeof parsed.context_values !== "object" ||
    parsed.context_values === null ||
    !Array.isArray(parsed.logs) ||
    typeof parsed.node_outcomes !== "object" ||
    parsed.node_outcomes === null
  ) {
    throw new Error(`Invalid checkpoint format in ${path}`)
  }

  return {
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    current_node: parsed.current_node,
    completed_nodes: parsed.completed_nodes.filter(
      (value): value is string => typeof value === "string",
    ),
    node_retries: Object.fromEntries(
      Object.entries(parsed.node_retries).map(([key, value]) => [
        key,
        typeof value === "number" ? value : 0,
      ]),
    ),
    context_values: { ...parsed.context_values },
    logs: parsed.logs.filter((value): value is string => typeof value === "string"),
    node_outcomes: { ...parsed.node_outcomes } as Record<string, Outcome>,
  }
}
