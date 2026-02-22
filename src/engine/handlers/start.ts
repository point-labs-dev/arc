import type { PipelineContext } from "../context/context"
import { type Outcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"

export class StartHandler implements Handler {
  execute(
    _node: GraphNode,
    _context: PipelineContext,
    _graph: GraphDefinition,
    _logsRoot?: string,
  ): Outcome {
    return successOutcome()
  }
}
