import { readAttributeInteger, readAttributeString } from "../attributes"
import { evaluateCondition } from "../context/conditions"
import { PipelineContext } from "../context/context"
import type { Outcome } from "../context/outcome"
import { outgoingEdges } from "../graph"
import type { GraphDefinition, GraphEdge, GraphNode } from "../types"

export const selectNextEdge = (
  node: GraphNode,
  outcome: Outcome,
  context: PipelineContext,
  graph: GraphDefinition,
): GraphEdge | undefined => {
  const edges = outgoingEdges(graph, node.id)
  if (edges.length === 0) {
    return undefined
  }

  const conditionMatched = edges.filter((edge) => {
    const condition = readAttributeString(edge.attrs, "condition").trim()
    return condition.length > 0 && evaluateCondition(condition, outcome, context)
  })

  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched)
  }

  const eligible = edges.filter((edge) => {
    const condition = readAttributeString(edge.attrs, "condition").trim()
    return condition.length === 0 || evaluateCondition(condition, outcome, context)
  })

  const preferredLabel = normalizeLabel(outcome.preferred_label)
  if (preferredLabel.length > 0) {
    for (const edge of eligible) {
      const edgeLabel = normalizeLabel(readAttributeString(edge.attrs, "label"))
      if (edgeLabel === preferredLabel) {
        return edge
      }
    }
  }

  if (outcome.suggested_next_ids.length > 0) {
    for (const suggestedId of outcome.suggested_next_ids) {
      const edge = eligible.find((candidate) => candidate.to === suggestedId)
      if (edge !== undefined) {
        return edge
      }
    }
  }

  const unconditional = eligible.filter(
    (edge) => readAttributeString(edge.attrs, "condition").trim().length === 0,
  )
  if (unconditional.length > 0) {
    return bestByWeightThenLexical(unconditional)
  }

  return bestByWeightThenLexical(eligible)
}

export const bestByWeightThenLexical = (edges: GraphEdge[]): GraphEdge | undefined => {
  if (edges.length === 0) {
    return undefined
  }

  return [...edges].sort((left, right) => {
    const leftWeight = readAttributeInteger(left.attrs, "weight", 0)
    const rightWeight = readAttributeInteger(right.attrs, "weight", 0)
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight
    }
    return left.to.localeCompare(right.to)
  })[0]
}

export const normalizeLabel = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ""
  }

  return stripAcceleratorPrefix(trimmed).trim().toLowerCase()
}

const stripAcceleratorPrefix = (value: string): string => {
  const bracket = value.match(/^\[[^\]]+\]\s*(.*)$/)
  if (bracket !== null) {
    return bracket[1]
  }

  const paren = value.match(/^[A-Za-z0-9]\)\s*(.*)$/)
  if (paren !== null) {
    return paren[1]
  }

  const hyphen = value.match(/^[A-Za-z0-9]\s*-\s*(.*)$/)
  if (hyphen !== null) {
    return hyphen[1]
  }

  return value
}
