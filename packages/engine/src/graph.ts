import { readAttributeString } from "./attributes"
import type { GraphDefinition, GraphEdge, GraphNode } from "./types"

export const findNodeById = (graph: GraphDefinition, nodeId: string): GraphNode | undefined =>
  graph.nodes.find((node) => node.id === nodeId)

export const requireNodeById = (graph: GraphDefinition, nodeId: string): GraphNode => {
  const node = findNodeById(graph, nodeId)
  if (node === undefined) {
    throw new Error(`Node "${nodeId}" does not exist`)
  }
  return node
}

export const outgoingEdges = (graph: GraphDefinition, nodeId: string): GraphEdge[] =>
  graph.edges.filter((edge) => edge.from === nodeId)

export const incomingEdges = (graph: GraphDefinition, nodeId: string): GraphEdge[] =>
  graph.edges.filter((edge) => edge.to === nodeId)

export const isStartNode = (node: GraphNode): boolean => {
  const shape = readAttributeString(node.attrs, "shape").trim()
  return shape === "Mdiamond" || node.id.toLowerCase() === "start"
}

export const isTerminalNode = (node: GraphNode): boolean => {
  const shape = readAttributeString(node.attrs, "shape").trim()
  const normalizedId = node.id.toLowerCase()
  return shape === "Msquare" || normalizedId === "exit" || normalizedId === "end"
}

export const findStartNode = (graph: GraphDefinition): GraphNode => {
  const starts = graph.nodes.filter((node) => isStartNode(node))
  if (starts.length !== 1) {
    throw new Error(`Pipeline must have exactly one start node; found ${starts.length}`)
  }
  return starts[0]
}
