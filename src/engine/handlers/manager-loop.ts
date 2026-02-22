import {
  readAttributeBoolean,
  readAttributeDurationMilliseconds,
  readAttributeInteger,
  readAttributeString,
} from "../attributes"
import { evaluateCondition } from "../context/conditions"
import type { PipelineContext } from "../context/context"
import { type Outcome, failOutcome, outcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"

const DEFAULT_POLL_INTERVAL_MS = 45_000
const DEFAULT_MAX_CYCLES = 1_000
const DEFAULT_MANAGER_ACTIONS = "observe,wait"

export interface ManagerLoopHandlerDependencies {
  readonly sleep?: (delayMs: number) => Promise<void>
}

export class ManagerLoopHandler implements Handler {
  private readonly sleep: (delayMs: number) => Promise<void>

  constructor(dependencies: ManagerLoopHandlerDependencies = {}) {
    this.sleep = dependencies.sleep ?? sleep
  }

  async execute(
    node: GraphNode,
    context: PipelineContext,
    _graph: GraphDefinition,
    _logsRoot?: string,
  ): Promise<Outcome> {
    const pollIntervalMs = Math.max(
      0,
      readAttributeDurationMilliseconds(node.attrs, "manager.poll_interval") ??
        DEFAULT_POLL_INTERVAL_MS,
    )
    const maxCycles = Math.max(
      1,
      readAttributeInteger(node.attrs, "manager.max_cycles", DEFAULT_MAX_CYCLES),
    )
    const stopCondition = readAttributeString(node.attrs, "manager.stop_condition").trim()
    const actions = parseActions(readActions(node))
    const childAutostart = readAttributeBoolean(node.attrs, "stack.child_autostart", true)

    if (childAutostart) {
      // Placeholder: child startup orchestration is not wired into the engine yet.
    }

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      if (actions.has("observe")) {
        // Placeholder: telemetry ingestion is intentionally a no-op in this MVP handler.
      }

      if (actions.has("steer")) {
        // Placeholder: manager steering interventions are not implemented yet.
      }

      const childStatus = readChildState(context, "status")
      const childOutcome = readChildState(context, "outcome")
      if (childStatus === "completed" && childOutcome === "success") {
        return successOutcome({
          notes: "Child completed",
        })
      }

      if (childStatus === "failed") {
        return failOutcome("Child failed")
      }

      if (
        stopCondition.length > 0 &&
        evaluateCondition(stopCondition, resolveConditionOutcome(context), context)
      ) {
        return successOutcome({
          notes: "Stop condition satisfied",
        })
      }

      if (actions.has("wait")) {
        await this.sleep(pollIntervalMs)
      }
    }

    return failOutcome("Max cycles exceeded")
  }
}

const readActions = (node: GraphNode): string => {
  const raw = readAttributeString(node.attrs, "manager.actions", DEFAULT_MANAGER_ACTIONS).trim()
  return raw.length > 0 ? raw : DEFAULT_MANAGER_ACTIONS
}

const parseActions = (raw: string): Set<string> =>
  new Set(
    raw
      .split(",")
      .map((action) => action.trim().toLowerCase())
      .filter((action) => action.length > 0),
  )

const readChildState = (context: PipelineContext, field: "status" | "outcome"): string => {
  const prefixed = context.getString(`context.stack.child.${field}`).trim().toLowerCase()
  if (prefixed.length > 0) {
    return prefixed
  }

  return context.getString(`stack.child.${field}`).trim().toLowerCase()
}

const resolveConditionOutcome = (context: PipelineContext): Outcome =>
  outcome({
    status: context.getString("outcome", "success"),
    preferred_label: context.getString("preferred_label"),
  })

const sleep = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
