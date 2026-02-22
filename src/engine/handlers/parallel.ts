import { readAttributeBoolean, readAttributeInteger, readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import {
  type Outcome,
  failOutcome,
  isSuccessfulOutcome,
  normalizeOutcome,
  successOutcome,
} from "../context/outcome"
import { selectNextEdge } from "../engine/edge-selection"
import { executeNodeWithRetry } from "../engine/execute-node-with-retry"
import type { BackoffConfig } from "../engine/retry"
import type { PipelineEventEmitter } from "../events/emitter"
import { isTerminalNode, outgoingEdges, requireNodeById } from "../graph"
import { type GraphDefinition, type GraphEdge, type GraphNode, SHAPE_TO_HANDLER } from "../types"
import type { Handler } from "./handler"
import { type ParallelBranchResult, normalizeParallelBranchResults } from "./parallel-results"

const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_MAX_BRANCH_STEPS = 1_000

export interface ParallelHandlerDependencies {
  readonly resolveHandler: (node: GraphNode) => Handler
  readonly eventEmitter?: PipelineEventEmitter
  readonly retryBackoff?: Partial<BackoffConfig>
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly random?: () => number
  readonly maxBranchSteps?: number
}

interface BranchExecutionResult {
  readonly result: ParallelBranchResult
  readonly failed: boolean
}

export class ParallelHandler implements Handler {
  constructor(private readonly dependencies: ParallelHandlerDependencies) {}

  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: GraphDefinition,
    logsRoot?: string,
  ): Promise<Outcome> {
    const branches = outgoingEdges(graph, node.id)
    if (branches.length === 0) {
      return failOutcome(`Parallel node "${node.id}" has no outgoing branch edges`)
    }

    const joinNodeId = findCommonFanInNode(graph, branches)
    if (joinNodeId === undefined) {
      return failOutcome(
        `Parallel node "${node.id}" has no reachable parallel.fan_in join across all branches`,
      )
    }

    const maxParallel = Math.max(
      1,
      readAttributeInteger(node.attrs, "max_parallel", DEFAULT_MAX_PARALLEL),
    )
    const joinPolicy = readAttributeString(node.attrs, "join_policy", "wait_all")
      .trim()
      .toLowerCase()
    const errorPolicy = readAttributeString(node.attrs, "error_policy", "continue")
      .trim()
      .toLowerCase()

    const branchResults = await this.executeBranches({
      branches,
      joinNodeId,
      context,
      graph,
      logsRoot,
      maxParallel,
      errorPolicy,
    })

    const results = normalizeParallelBranchResults(branchResults)
    const joined = evaluateJoinPolicy(node, results, joinPolicy, errorPolicy)
    const contextUpdates: Record<string, unknown> = {
      "parallel.results": results,
      [`parallel.results.${node.id}`]: results,
      "parallel.join_node": joinNodeId,
      "parallel.join_policy": joinPolicy,
      "parallel.error_policy": errorPolicy,
      "parallel.success_count": joined.successCount,
      "parallel.fail_count": joined.failCount,
    }

    if (joined.status === "fail") {
      return failOutcome(joined.reason, {
        suggested_next_ids: [joinNodeId],
        context_updates: contextUpdates,
        notes: `Parallel join failed at node ${node.id}`,
      })
    }

    if (joined.status === "partial_success") {
      return normalizeOutcome({
        status: "partial_success",
        suggested_next_ids: [joinNodeId],
        context_updates: contextUpdates,
        notes: `Parallel branches completed: ${results.length} (join=${joinPolicy})`,
      })
    }

    return successOutcome({
      suggested_next_ids: [joinNodeId],
      context_updates: contextUpdates,
      notes: `Parallel branches completed: ${results.length} (join=${joinPolicy})`,
    })
  }

  private async executeBranches(input: {
    branches: GraphEdge[]
    joinNodeId: string
    context: PipelineContext
    graph: GraphDefinition
    logsRoot?: string
    maxParallel: number
    errorPolicy: string
  }): Promise<ParallelBranchResult[]> {
    const workers = Math.min(input.maxParallel, input.branches.length)
    const results: Array<ParallelBranchResult | undefined> = Array.from(
      { length: input.branches.length },
      () => undefined,
    )

    let nextIndex = 0
    let stopScheduling = false

    const runWorker = async (): Promise<void> => {
      while (true) {
        if (stopScheduling) {
          return
        }

        const index = nextIndex
        nextIndex += 1
        if (index >= input.branches.length) {
          return
        }

        const edge = input.branches[index]
        const branchResult = await this.executeBranch({
          branchEdge: edge,
          joinNodeId: input.joinNodeId,
          context: input.context,
          graph: input.graph,
          logsRoot: input.logsRoot,
        })

        results[index] = branchResult.result
        if (input.errorPolicy === "fail_fast" && branchResult.failed) {
          stopScheduling = true
        }
      }
    }

    await Promise.all(Array.from({ length: workers }, () => runWorker()))

    for (let index = 0; index < input.branches.length; index += 1) {
      if (results[index] !== undefined) {
        continue
      }

      const edge = input.branches[index]
      results[index] = {
        branch_id: edge.to,
        start_node_id: edge.to,
        terminal_node_id: edge.to,
        completed_nodes: [],
        outcome: normalizeOutcome({
          status: "skipped",
          notes: "Skipped due to fail_fast policy",
        }),
        score: 0,
      }
    }

    return results.filter((result): result is ParallelBranchResult => result !== undefined)
  }

  private async executeBranch(input: {
    branchEdge: GraphEdge
    joinNodeId: string
    context: PipelineContext
    graph: GraphDefinition
    logsRoot?: string
  }): Promise<BranchExecutionResult> {
    const branchContext = input.context.clone()
    const completedNodes: string[] = []

    let currentNodeId = input.branchEdge.to
    let terminalNodeId = currentNodeId
    let lastOutcome = successOutcome({
      notes: `Branch "${input.branchEdge.to}" reached join node`,
    })
    let reachedTermination = false

    const maxSteps = Math.max(1, this.dependencies.maxBranchSteps ?? DEFAULT_MAX_BRANCH_STEPS)

    for (let steps = 0; steps < maxSteps; steps += 1) {
      if (currentNodeId === input.joinNodeId) {
        terminalNodeId = currentNodeId
        reachedTermination = true
        break
      }

      const currentNode = requireNodeById(input.graph, currentNodeId)
      if (isTerminalNode(currentNode)) {
        terminalNodeId = currentNode.id
        reachedTermination = true
        break
      }

      if (isNodeType(currentNode, "parallel.fan_in")) {
        terminalNodeId = currentNode.id
        reachedTermination = true
        break
      }

      const handler = this.dependencies.resolveHandler(currentNode)
      const outcome = await executeNodeWithRetry({
        graph: input.graph,
        node: currentNode,
        handler,
        context: branchContext,
        logsRoot: input.logsRoot,
        emitter: this.dependencies.eventEmitter,
        retryBackoff: this.dependencies.retryBackoff,
        sleep: this.dependencies.sleep,
        random: this.dependencies.random,
      })

      lastOutcome = outcome
      terminalNodeId = currentNode.id
      if (outcome.status !== "skipped") {
        completedNodes.push(currentNode.id)
      }

      branchContext.applyUpdates(outcome.context_updates)
      branchContext.set("outcome", outcome.status)
      if (outcome.preferred_label.trim().length > 0) {
        branchContext.set("preferred_label", outcome.preferred_label)
      }

      const nextEdge = selectNextEdge(currentNode, outcome, branchContext, input.graph)
      if (nextEdge === undefined) {
        reachedTermination = true
        break
      }

      if (readAttributeBoolean(nextEdge.attrs, "loop_restart", false)) {
        lastOutcome = failOutcome("loop_restart=true edges are not supported in branch execution")
        reachedTermination = true
        break
      }

      if (nextEdge.to === input.joinNodeId) {
        terminalNodeId = currentNode.id
        reachedTermination = true
        break
      }

      currentNodeId = nextEdge.to
    }

    if (!reachedTermination) {
      lastOutcome = failOutcome(
        `Parallel branch "${input.branchEdge.to}" exceeded max step limit (${maxSteps})`,
      )
    }

    const branchResult: ParallelBranchResult = {
      branch_id: input.branchEdge.to,
      start_node_id: input.branchEdge.to,
      terminal_node_id: terminalNodeId,
      completed_nodes: completedNodes,
      outcome: lastOutcome,
      score: extractScore(lastOutcome),
    }

    return {
      result: branchResult,
      failed: lastOutcome.status === "fail",
    }
  }
}

const evaluateJoinPolicy = (
  node: GraphNode,
  results: ParallelBranchResult[],
  joinPolicy: string,
  errorPolicy: string,
): {
  readonly status: "success" | "partial_success" | "fail"
  readonly reason: string
  readonly successCount: number
  readonly failCount: number
} => {
  const considered =
    errorPolicy === "ignore"
      ? results.filter((result) => result.outcome.status !== "fail")
      : results

  const successCount = considered.filter((result) => isSuccessfulOutcome(result.outcome)).length
  const failCount = considered.filter((result) => result.outcome.status === "fail").length

  if (considered.length === 0) {
    return {
      status: "fail",
      reason: `Parallel join policy "${joinPolicy}" has no successful candidates`,
      successCount: 0,
      failCount: results.length,
    }
  }

  if (joinPolicy === "" || joinPolicy === "wait_all") {
    if (failCount === 0) {
      return { status: "success", reason: "", successCount, failCount }
    }
    return {
      status: "partial_success",
      reason: `Parallel wait_all join observed ${failCount} failed branches`,
      successCount,
      failCount,
    }
  }

  if (joinPolicy === "first_success") {
    if (successCount > 0) {
      return { status: "success", reason: "", successCount, failCount }
    }
    return {
      status: "fail",
      reason: "Parallel first_success join did not produce a successful branch",
      successCount,
      failCount,
    }
  }

  if (joinPolicy === "k_of_n") {
    const required = Math.max(
      1,
      readAttributeInteger(node.attrs, "join_k", readAttributeInteger(node.attrs, "k", 1)),
    )
    if (successCount >= required) {
      return { status: "success", reason: "", successCount, failCount }
    }
    return {
      status: "fail",
      reason: `Parallel k_of_n join requires ${required} successes, observed ${successCount}`,
      successCount,
      failCount,
    }
  }

  if (joinPolicy === "quorum") {
    const quorum = readFraction(node, "join_quorum", readFraction(node, "quorum", 0.5))
    const observed = successCount / considered.length
    if (observed >= quorum) {
      return { status: "success", reason: "", successCount, failCount }
    }
    return {
      status: "fail",
      reason: `Parallel quorum join requires ${quorum}, observed ${observed.toFixed(3)}`,
      successCount,
      failCount,
    }
  }

  return {
    status: "fail",
    reason: `Unsupported parallel join_policy "${joinPolicy}"`,
    successCount,
    failCount,
  }
}

const findCommonFanInNode = (graph: GraphDefinition, branches: GraphEdge[]): string | undefined => {
  const branchStarts = branches.map((branch) => branch.to)
  const fanInIds = graph.nodes
    .filter((node) => isNodeType(node, "parallel.fan_in"))
    .map((node) => node.id)

  if (fanInIds.length === 0) {
    return undefined
  }

  const distancesByBranch = branchStarts.map((startNodeId) =>
    computeShortestDistances(graph, startNodeId),
  )
  const candidates = fanInIds.filter((fanInId) =>
    distancesByBranch.every((distances) => distances.has(fanInId)),
  )

  if (candidates.length === 0) {
    return undefined
  }

  return [...candidates].sort((left, right) => {
    const leftDistance = distancesByBranch.reduce(
      (sum, distances) => sum + (distances.get(left) ?? Number.MAX_SAFE_INTEGER),
      0,
    )
    const rightDistance = distancesByBranch.reduce(
      (sum, distances) => sum + (distances.get(right) ?? Number.MAX_SAFE_INTEGER),
      0,
    )

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance
    }
    return left.localeCompare(right)
  })[0]
}

const computeShortestDistances = (
  graph: GraphDefinition,
  startNodeId: string,
): Map<string, number> => {
  const distances = new Map<string, number>()
  const queue: Array<{ nodeId: string; distance: number }> = [{ nodeId: startNodeId, distance: 0 }]

  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) {
      continue
    }

    if (distances.has(next.nodeId)) {
      continue
    }

    distances.set(next.nodeId, next.distance)
    for (const edge of outgoingEdges(graph, next.nodeId)) {
      if (!distances.has(edge.to)) {
        queue.push({ nodeId: edge.to, distance: next.distance + 1 })
      }
    }
  }

  return distances
}

const isNodeType = (node: GraphNode, type: string): boolean => {
  const explicitType = readAttributeString(node.attrs, "type").trim()
  if (explicitType.length > 0) {
    return explicitType === type
  }

  const shape = readAttributeString(node.attrs, "shape").trim()
  return SHAPE_TO_HANDLER[shape] === type
}

const readFraction = (node: GraphNode, key: string, fallback: number): number => {
  const raw = readAttributeString(node.attrs, key).trim()
  if (raw.length === 0) {
    return fallback
  }

  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.min(1, value))
}

const extractScore = (outcome: Outcome): number => {
  const candidate =
    outcome.context_updates.score ??
    outcome.context_updates["parallel.score"] ??
    outcome.context_updates["candidate.score"]

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate
  }

  if (typeof candidate === "string") {
    const parsed = Number.parseFloat(candidate)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}
