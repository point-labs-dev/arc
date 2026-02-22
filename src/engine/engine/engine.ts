import { join } from "node:path"

import {
  attributeValueToSerializable,
  readAttributeBoolean,
  readAttributeString,
} from "../attributes"
import { PipelineContext } from "../context/context"
import { type Outcome, normalizeOutcome } from "../context/outcome"
import { NoopEventEmitter, type PipelineEventEmitter } from "../events/emitter"
import type { PipelineEvent } from "../events/events"
import { findNodeById, findStartNode, isTerminalNode, requireNodeById } from "../graph"
import { listStageArtifactPaths, writeStageStatusArtifact } from "../handlers/artifacts"
import type { CodergenBackend } from "../handlers/codergen"
import {
  type DefaultHandlerDependencies,
  type HandlerRegistry,
  createDefaultHandlerRegistry,
} from "../handlers/handler"
import type { Interviewer } from "../interviewer"
import { applyModelStylesheet } from "../stylesheet"
import { type Diagnostic, type GraphDefinition, SHAPE_TO_HANDLER, ValidationError } from "../types"
import { validate } from "../validation"
import {
  type CommandSatisfactionJudgeOptions,
  type SatisfactionInput,
  type SatisfactionJudge,
  type SatisfactionResult,
  createCommandSatisfactionJudge,
  evaluateSatisfaction,
} from "../verification/satisfaction"
import { createCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint"
import { selectNextEdge } from "./edge-selection"
import { executeNodeWithRetry } from "./execute-node-with-retry"
import { findUnsatisfiedGoalGate, resolveRetryTarget } from "./goal-gates"
import { type BackoffConfig, buildRetryPolicy } from "./retry"

export interface PipelineSatisfactionConfig {
  readonly input: SatisfactionInput
  readonly threshold?: number
  readonly judge?: SatisfactionJudge
  readonly command_judge?: CommandSatisfactionJudgeOptions
  readonly allow_heuristic_fallback?: boolean
}

export interface PipelineRunConfig {
  readonly logsRoot?: string
  readonly checkpointPath?: string
  readonly context?: PipelineContext
  readonly eventEmitter?: PipelineEventEmitter
  readonly codergenBackend?: CodergenBackend
  readonly interviewer?: Interviewer
  readonly handlerRegistry?: HandlerRegistry
  readonly toolRunner?: DefaultHandlerDependencies["toolRunner"]
  readonly validateGraph?: boolean
  readonly resumeFromCheckpoint?: boolean
  readonly maxNodeExecutions?: number
  readonly retryBackoff?: Partial<BackoffConfig>
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly random?: () => number
  readonly satisfaction?: PipelineSatisfactionConfig
}

export type PipelineRunStatus = "success" | "fail" | "interrupted"

export interface PipelineRunResult {
  readonly status: PipelineRunStatus
  readonly pipeline_id: string
  readonly completed_nodes: string[]
  readonly node_outcomes: Record<string, Outcome>
  readonly context_values: Record<string, unknown>
  readonly diagnostics: Diagnostic[]
  readonly checkpoint_path?: string
  readonly failure_reason?: string
}

interface ExecutionState {
  context: PipelineContext
  completedNodes: string[]
  nodeOutcomes: Record<string, Outcome>
  nodeRetries: Record<string, number>
  currentNodeId: string
  nodeExecutionCount: number
  restartCount: number
}

export const runPipeline = async (
  graph: GraphDefinition,
  config: PipelineRunConfig = {},
): Promise<PipelineRunResult> => {
  const executionGraph = cloneGraphForExecution(graph)
  const diagnostics = validateGraphIfEnabled(executionGraph, config.validateGraph)
  applyModelStylesheet(executionGraph)

  const pipelineId = `${executionGraph.id}-${Date.now()}`
  const startedAt = Date.now()

  const emitter = config.eventEmitter ?? new NoopEventEmitter()
  await emitEvent(emitter, {
    type: "pipeline_started",
    pipeline_id: pipelineId,
    pipeline_name: executionGraph.id,
    started_at: new Date(startedAt).toISOString(),
  })

  const checkpointPath = resolveCheckpointPath(config)
  const registry =
    config.handlerRegistry ??
    createDefaultHandlerRegistry({
      codergenBackend: config.codergenBackend,
      interviewer: config.interviewer,
      toolRunner: config.toolRunner,
      eventEmitter: emitter,
      retryBackoff: config.retryBackoff,
      sleep: config.sleep,
      random: config.random,
    })

  const state = await initializeExecutionState(executionGraph, config, checkpointPath)
  const restartContextSeed = {
    values: state.context.snapshot(),
    logs: state.context.logEntries(),
  }

  try {
    while (true) {
      const executionLogsRoot = resolveExecutionLogsRoot(config.logsRoot, state.restartCount)
      const currentNode = requireNodeById(executionGraph, state.currentNodeId)
      state.context.set("current_node", currentNode.id)

      if (isTerminalNode(currentNode)) {
        const unsatisfiedGoalGate = findUnsatisfiedGoalGate(executionGraph, state.nodeOutcomes)
        if (unsatisfiedGoalGate !== undefined) {
          const retryTarget = resolveRetryTarget(unsatisfiedGoalGate, executionGraph)
          if (retryTarget !== undefined) {
            state.currentNodeId = retryTarget
            continue
          }

          const failureReason = `Goal gate unsatisfied at node "${unsatisfiedGoalGate.id}" with no retry target`
          await emitEvent(emitter, {
            type: "pipeline_failed",
            pipeline_id: pipelineId,
            duration_ms: Date.now() - startedAt,
            error: failureReason,
          })

          return {
            status: "fail",
            pipeline_id: pipelineId,
            completed_nodes: [...state.completedNodes],
            node_outcomes: { ...state.nodeOutcomes },
            context_values: state.context.snapshot(),
            diagnostics,
            checkpoint_path: checkpointPath,
            failure_reason: failureReason,
          }
        }

        const satisfactionResult = await evaluateConfiguredSatisfaction(
          config.satisfaction,
          emitter,
        )
        if (satisfactionResult !== undefined) {
          state.context.set("verification.satisfaction.score", satisfactionResult.score)
          state.context.set("verification.satisfaction.threshold", satisfactionResult.threshold)
          state.context.set("verification.satisfaction.passed", satisfactionResult.passed)
          state.context.set("verification.satisfaction.rationale", satisfactionResult.rationale)

          if (!satisfactionResult.passed) {
            const failureReason = `Satisfaction score ${satisfactionResult.score.toFixed(
              3,
            )} below threshold ${satisfactionResult.threshold.toFixed(3)}`
            await emitEvent(emitter, {
              type: "pipeline_failed",
              pipeline_id: pipelineId,
              duration_ms: Date.now() - startedAt,
              error: failureReason,
            })

            return {
              status: "fail",
              pipeline_id: pipelineId,
              completed_nodes: [...state.completedNodes],
              node_outcomes: { ...state.nodeOutcomes },
              context_values: state.context.snapshot(),
              diagnostics,
              checkpoint_path: checkpointPath,
              failure_reason: failureReason,
            }
          }
        }

        await emitEvent(emitter, {
          type: "pipeline_completed",
          pipeline_id: pipelineId,
          duration_ms: Date.now() - startedAt,
        })

        return {
          status: "success",
          pipeline_id: pipelineId,
          completed_nodes: [...state.completedNodes],
          node_outcomes: { ...state.nodeOutcomes },
          context_values: state.context.snapshot(),
          diagnostics,
          checkpoint_path: checkpointPath,
        }
      }

      const handler = registry.resolve(currentNode)
      const retryPolicy = buildRetryPolicy(currentNode, executionGraph, config.retryBackoff)
      const outcome = await executeNodeWithRetry({
        graph: executionGraph,
        node: currentNode,
        handler,
        retryPolicy,
        nodeRetries: state.nodeRetries,
        context: state.context,
        logsRoot: executionLogsRoot,
        emitter,
        sleep: config.sleep,
        random: config.random,
      })

      if (outcome.status !== "skipped") {
        state.completedNodes.push(currentNode.id)
        state.nodeOutcomes[currentNode.id] = outcome
      }

      state.context.applyUpdates(outcome.context_updates)
      state.context.set("outcome", outcome.status)
      if (outcome.preferred_label.trim().length > 0) {
        state.context.set("preferred_label", outcome.preferred_label)
      }

      await writeStageStatusArtifact(executionLogsRoot, currentNode.id, outcome)
      await captureStageArtifactsInContext(executionLogsRoot, currentNode.id, state.context)

      if (checkpointPath !== undefined) {
        await saveCheckpoint(
          checkpointPath,
          createCheckpoint({
            currentNode: currentNode.id,
            completedNodes: state.completedNodes,
            nodeRetries: state.nodeRetries,
            contextValues: state.context.snapshot(),
            logs: state.context.logEntries(),
            nodeOutcomes: state.nodeOutcomes,
          }),
        )

        await emitEvent(emitter, {
          type: "checkpoint_saved",
          node_id: currentNode.id,
          path: checkpointPath,
        })
      }

      state.nodeExecutionCount += 1
      if (
        config.maxNodeExecutions !== undefined &&
        state.nodeExecutionCount >= config.maxNodeExecutions
      ) {
        return {
          status: "interrupted",
          pipeline_id: pipelineId,
          completed_nodes: [...state.completedNodes],
          node_outcomes: { ...state.nodeOutcomes },
          context_values: state.context.snapshot(),
          diagnostics,
          checkpoint_path: checkpointPath,
          failure_reason: "Execution interrupted by maxNodeExecutions limit",
        }
      }

      const suggestedNextNodeId = resolveSuggestedNodeOverrideForParallel(
        currentNode,
        outcome,
        executionGraph,
      )
      if (suggestedNextNodeId !== undefined) {
        state.currentNodeId = suggestedNextNodeId
        continue
      }

      const nextEdge = selectNextEdge(currentNode, outcome, state.context, executionGraph)
      if (nextEdge === undefined) {
        if (outcome.status === "fail") {
          const failureReason = outcome.failure_reason || `Node "${currentNode.id}" failed`
          await emitEvent(emitter, {
            type: "pipeline_failed",
            pipeline_id: pipelineId,
            duration_ms: Date.now() - startedAt,
            error: failureReason,
          })

          return {
            status: "fail",
            pipeline_id: pipelineId,
            completed_nodes: [...state.completedNodes],
            node_outcomes: { ...state.nodeOutcomes },
            context_values: state.context.snapshot(),
            diagnostics,
            checkpoint_path: checkpointPath,
            failure_reason: failureReason,
          }
        }

        await emitEvent(emitter, {
          type: "pipeline_completed",
          pipeline_id: pipelineId,
          duration_ms: Date.now() - startedAt,
        })

        return {
          status: "success",
          pipeline_id: pipelineId,
          completed_nodes: [...state.completedNodes],
          node_outcomes: { ...state.nodeOutcomes },
          context_values: state.context.snapshot(),
          diagnostics,
          checkpoint_path: checkpointPath,
        }
      }

      if (readAttributeBoolean(nextEdge.attrs, "loop_restart", false)) {
        restartExecutionState(state, restartContextSeed, nextEdge.to)
        continue
      }

      state.currentNodeId = nextEdge.to
    }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error)

    await emitEvent(emitter, {
      type: "pipeline_failed",
      pipeline_id: pipelineId,
      duration_ms: Date.now() - startedAt,
      error: failureReason,
    })

    return {
      status: "fail",
      pipeline_id: pipelineId,
      completed_nodes: [...state.completedNodes],
      node_outcomes: { ...state.nodeOutcomes },
      context_values: state.context.snapshot(),
      diagnostics,
      checkpoint_path: checkpointPath,
      failure_reason: failureReason,
    }
  }
}

export const runPipelineFromDot = async (
  dotSource: string,
  config: PipelineRunConfig = {},
): Promise<PipelineRunResult> => {
  const { parseDot } = await import("../parser")
  const graph = parseDot(dotSource)
  return runPipeline(graph, config)
}

const cloneGraphForExecution = (graph: GraphDefinition): GraphDefinition => ({
  id: graph.id,
  attrs: { ...graph.attrs },
  nodes: graph.nodes.map((node) => ({
    ...node,
    attrs: { ...node.attrs },
    explicitAttrs: node.explicitAttrs === undefined ? undefined : [...node.explicitAttrs],
  })),
  edges: graph.edges.map((edge) => ({
    ...edge,
    attrs: { ...edge.attrs },
  })),
})

const initializeExecutionState = async (
  graph: GraphDefinition,
  config: PipelineRunConfig,
  checkpointPath: string | undefined,
): Promise<ExecutionState> => {
  if (!config.resumeFromCheckpoint || checkpointPath === undefined) {
    const context = config.context ?? new PipelineContext()
    mirrorGraphAttributesIntoContext(graph, context)

    return {
      context,
      completedNodes: [],
      nodeOutcomes: {},
      nodeRetries: {},
      currentNodeId: findStartNode(graph).id,
      nodeExecutionCount: 0,
      restartCount: 0,
    }
  }

  const checkpoint = await loadCheckpoint(checkpointPath)
  const context = PipelineContext.fromSnapshot(checkpoint.context_values, checkpoint.logs)
  mirrorGraphAttributesIntoContext(graph, context)

  const normalizedOutcomes = Object.fromEntries(
    Object.entries(checkpoint.node_outcomes).map(([nodeId, value]) => [
      nodeId,
      normalizeOutcome(value),
    ]),
  )

  const resumeFromNode = requireNodeById(graph, checkpoint.current_node)
  const resumeOutcome = normalizedOutcomes[checkpoint.current_node]

  let currentNodeId = resumeFromNode.id
  if (resumeOutcome !== undefined && !isTerminalNode(resumeFromNode)) {
    const nextEdge = selectNextEdge(resumeFromNode, resumeOutcome, context, graph)
    if (nextEdge !== undefined) {
      currentNodeId = nextEdge.to
    }
  }

  return {
    context,
    completedNodes: [...checkpoint.completed_nodes],
    nodeOutcomes: normalizedOutcomes,
    nodeRetries: { ...checkpoint.node_retries },
    currentNodeId,
    nodeExecutionCount: checkpoint.completed_nodes.length,
    restartCount: 0,
  }
}

const validateGraphIfEnabled = (
  graph: GraphDefinition,
  validateGraph: boolean | undefined,
): Diagnostic[] => {
  if (validateGraph === false) {
    return []
  }

  const diagnostics = validate(graph)
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")
  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
  return diagnostics
}

const mirrorGraphAttributesIntoContext = (
  graph: GraphDefinition,
  context: PipelineContext,
): void => {
  for (const [key, value] of Object.entries(graph.attrs)) {
    const contextKey = `graph.${key}`
    if (!context.has(contextKey)) {
      context.set(contextKey, attributeValueToSerializable(value))
    }
  }
}

const resolveCheckpointPath = (config: PipelineRunConfig): string | undefined => {
  if (config.checkpointPath !== undefined) {
    return config.checkpointPath
  }

  if (config.logsRoot !== undefined) {
    return join(config.logsRoot, "checkpoint.json")
  }

  return undefined
}

const resolveExecutionLogsRoot = (
  logsRoot: string | undefined,
  restartCount: number,
): string | undefined => {
  if (logsRoot === undefined || logsRoot.length === 0) {
    return undefined
  }

  if (restartCount <= 0) {
    return logsRoot
  }

  return join(logsRoot, `restart-${restartCount}`)
}

const restartExecutionState = (
  state: ExecutionState,
  seed: { values: Record<string, unknown>; logs: string[] },
  nextNodeId: string,
): void => {
  state.context = PipelineContext.fromSnapshot(seed.values, seed.logs)
  state.completedNodes = []
  state.nodeOutcomes = {}
  state.nodeRetries = {}
  state.currentNodeId = nextNodeId
  state.restartCount += 1
}

const captureStageArtifactsInContext = async (
  logsRoot: string | undefined,
  nodeId: string,
  context: PipelineContext,
): Promise<void> => {
  const artifacts = await listStageArtifactPaths(logsRoot, nodeId)
  if (artifacts === undefined) {
    return
  }

  const stagePrefix = `artifacts.${nodeId}`
  context.set(`${stagePrefix}.dir`, artifacts.stageDir)
  context.set(`${stagePrefix}.paths`, artifacts.paths)

  const existing = context.get("artifacts.paths")
  const existingByNode =
    typeof existing === "object" && existing !== null && !Array.isArray(existing) ? existing : {}

  context.set("artifacts.paths", {
    ...existingByNode,
    [nodeId]: artifacts.paths,
  })
}

const resolveSuggestedNodeOverrideForParallel = (
  node: GraphDefinition["nodes"][number],
  outcome: Outcome,
  graph: GraphDefinition,
): string | undefined => {
  if (resolveNodeHandlerType(node) !== "parallel") {
    return undefined
  }

  for (const candidate of outcome.suggested_next_ids) {
    if (candidate === node.id) {
      continue
    }
    if (findNodeById(graph, candidate) !== undefined) {
      return candidate
    }
  }

  return undefined
}

const resolveNodeHandlerType = (node: GraphDefinition["nodes"][number]): string => {
  const explicitType = readAttributeString(node.attrs, "type").trim()
  if (explicitType.length > 0) {
    return explicitType
  }

  const shape = readAttributeString(node.attrs, "shape").trim()
  return SHAPE_TO_HANDLER[shape] ?? ""
}

const evaluateConfiguredSatisfaction = async (
  config: PipelineSatisfactionConfig | undefined,
  emitter: PipelineEventEmitter,
): Promise<SatisfactionResult | undefined> => {
  if (config === undefined) {
    return undefined
  }

  const judge =
    config.judge ??
    (config.command_judge === undefined
      ? undefined
      : createCommandSatisfactionJudge(config.command_judge))

  return evaluateSatisfaction({
    input: config.input,
    threshold: config.threshold,
    judge,
    allow_heuristic_fallback: config.allow_heuristic_fallback,
    on_event: async (event) => {
      await emitEvent(emitter, event)
    },
  })
}

const emitEvent = async (emitter: PipelineEventEmitter, event: PipelineEvent): Promise<void> => {
  await emitter.emit(event)
}
