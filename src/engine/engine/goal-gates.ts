import { readAttributeBoolean, readAttributeString } from "../attributes"
import type { Outcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"

export const findUnsatisfiedGoalGate = (
  graph: GraphDefinition,
  nodeOutcomes: Record<string, Outcome>,
): GraphNode | undefined => {
  for (const node of graph.nodes) {
    if (!readAttributeBoolean(node.attrs, "goal_gate", false)) {
      continue
    }

    const outcome = nodeOutcomes[node.id]
    if (outcome === undefined) {
      return node
    }

    if (outcome.status !== "success" && outcome.status !== "partial_success") {
      return node
    }
  }

  return undefined
}

export const resolveRetryTarget = (node: GraphNode, graph: GraphDefinition): string | undefined => {
  const nodeRetryTarget = readAttributeString(node.attrs, "retry_target").trim()
  if (nodeRetryTarget.length > 0) {
    return nodeRetryTarget
  }

  const nodeFallbackTarget = readAttributeString(node.attrs, "fallback_retry_target").trim()
  if (nodeFallbackTarget.length > 0) {
    return nodeFallbackTarget
  }

  const graphRetryTarget = readAttributeString(graph.attrs, "retry_target").trim()
  if (graphRetryTarget.length > 0) {
    return graphRetryTarget
  }

  const graphFallbackTarget = readAttributeString(graph.attrs, "fallback_retry_target").trim()
  if (graphFallbackTarget.length > 0) {
    return graphFallbackTarget
  }

  return undefined
}
