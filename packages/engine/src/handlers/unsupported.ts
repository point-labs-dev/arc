import type { PipelineContext } from "../context/context"
import { type Outcome, failOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"

export class UnsupportedHandler implements Handler {
  constructor(private readonly handlerType: string) {}

  execute(
    node: GraphNode,
    _context: PipelineContext,
    _graph: GraphDefinition,
    _logsRoot?: string,
  ): Outcome {
    return failOutcome(
      `Handler type "${this.handlerType}" is not implemented for node "${node.id}"`,
    )
  }
}
