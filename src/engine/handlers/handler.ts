import { readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import type { Outcome } from "../context/outcome"
import type { BackoffConfig } from "../engine/retry"
import type { PipelineEventEmitter } from "../events/emitter"
import type { Interviewer } from "../interviewer"
import { type GraphDefinition, type GraphNode, SHAPE_TO_HANDLER } from "../types"
import { type CodergenBackend, CodergenHandler } from "./codergen"
import { ConditionalHandler } from "./conditional"
import { ExitHandler } from "./exit"
import { FanInHandler } from "./fan-in"
import { ParallelHandler } from "./parallel"
import { StartHandler } from "./start"
import { ToolHandler, type ToolRunner } from "./tool"
import { UnsupportedHandler } from "./unsupported"
import { WaitForHumanHandler } from "./wait-human"

export interface Handler {
  execute(
    node: GraphNode,
    context: PipelineContext,
    graph: GraphDefinition,
    logsRoot?: string,
  ): Promise<Outcome> | Outcome
}

export class HandlerRegistry {
  private readonly handlers = new Map<string, Handler>()

  constructor(private readonly defaultHandler: Handler) {}

  register(handlerType: string, handler: Handler): void {
    this.handlers.set(handlerType, handler)
  }

  resolve(node: GraphNode): Handler {
    const explicitType = readAttributeString(node.attrs, "type").trim()
    if (explicitType.length > 0) {
      const explicit = this.handlers.get(explicitType)
      if (explicit !== undefined) {
        return explicit
      }
    }

    const shape = readAttributeString(node.attrs, "shape").trim()
    if (shape.length > 0) {
      const mapped = SHAPE_TO_HANDLER[shape]
      if (mapped !== undefined) {
        const byShape = this.handlers.get(mapped)
        if (byShape !== undefined) {
          return byShape
        }
      }
    }

    return this.defaultHandler
  }
}

export interface DefaultHandlerDependencies {
  readonly codergenBackend?: CodergenBackend
  readonly interviewer?: Interviewer
  readonly toolRunner?: ToolRunner
  readonly eventEmitter?: PipelineEventEmitter
  readonly retryBackoff?: Partial<BackoffConfig>
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly random?: () => number
}

export const createDefaultHandlerRegistry = (
  dependencies: DefaultHandlerDependencies = {},
): HandlerRegistry => {
  const codergen = new CodergenHandler(dependencies.codergenBackend)
  const registry = new HandlerRegistry(codergen)

  registry.register("start", new StartHandler())
  registry.register("exit", new ExitHandler())
  registry.register("codergen", codergen)
  registry.register("wait.human", new WaitForHumanHandler(dependencies.interviewer))
  registry.register("conditional", new ConditionalHandler())
  registry.register("tool", new ToolHandler(dependencies.toolRunner))

  registry.register(
    "parallel",
    new ParallelHandler({
      resolveHandler: (node) => registry.resolve(node),
      eventEmitter: dependencies.eventEmitter,
      retryBackoff: dependencies.retryBackoff,
      sleep: dependencies.sleep,
      random: dependencies.random,
    }),
  )
  registry.register("parallel.fan_in", new FanInHandler())
  registry.register("stack.manager_loop", new UnsupportedHandler("stack.manager_loop"))

  return registry
}
