import type { PipelineContext } from "../context/context"
import { type Outcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"

export class ConditionalHandler implements Handler {
  execute(
    node: GraphNode,
    _context: PipelineContext,
    _graph: GraphDefinition,
    _logsRoot?: string,
  ): Outcome {
    return successOutcome({
      notes: `Conditional node evaluated: ${node.id}`,
    })
  }
}
