import { describe, expect, it } from "vitest"

import { PipelineContext } from "../context/context"
import type { GraphDefinition, GraphNode } from "../types"
import { createDefaultHandlerRegistry } from "./handler"
import { ManagerLoopHandler } from "./manager-loop"

const graph: GraphDefinition = {
  id: "ManagerLoop",
  attrs: {},
  nodes: [],
  edges: [],
}

const managerNode = (attrs: GraphNode["attrs"] = {}): GraphNode => ({
  id: "manager",
  attrs: {
    shape: "house",
    ...attrs,
  },
})

describe("ManagerLoopHandler", () => {
  it("returns success when child status is completed with success outcome", async () => {
    const context = new PipelineContext({
      "context.stack.child.status": "completed",
      "context.stack.child.outcome": "success",
    })
    const handler = new ManagerLoopHandler({
      sleep: async () => {
        throw new Error("sleep should not be called")
      },
    })

    const result = await handler.execute(managerNode(), context, graph)

    expect(result.status).toBe("success")
    expect(result.notes).toBe("Child completed")
  })

  it("returns fail when child status is failed", async () => {
    const context = new PipelineContext({
      "stack.child.status": "failed",
    })
    const handler = new ManagerLoopHandler({
      sleep: async () => {
        throw new Error("sleep should not be called")
      },
    })

    const result = await handler.execute(managerNode(), context, graph)

    expect(result.status).toBe("fail")
    expect(result.failure_reason).toBe("Child failed")
  })

  it("returns success when manager.stop_condition evaluates true", async () => {
    const context = new PipelineContext({
      "stack.should_stop": true,
    })
    const handler = new ManagerLoopHandler()

    const result = await handler.execute(
      managerNode({
        "manager.actions": "observe",
        "manager.stop_condition": "context.stack.should_stop=true",
      }),
      context,
      graph,
    )

    expect(result.status).toBe("success")
    expect(result.notes).toBe("Stop condition satisfied")
  })

  it("returns fail when max cycle count is exhausted", async () => {
    const sleepCalls: number[] = []
    const handler = new ManagerLoopHandler({
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs)
      },
    })

    const result = await handler.execute(
      managerNode({
        "manager.max_cycles": 2,
        "manager.poll_interval": "5s",
      }),
      new PipelineContext(),
      graph,
    )

    expect(result.status).toBe("fail")
    expect(result.failure_reason).toBe("Max cycles exceeded")
    expect(sleepCalls).toEqual([5_000, 5_000])
  })

  it("resolves shape and explicit type to ManagerLoopHandler in the default registry", () => {
    const registry = createDefaultHandlerRegistry({
      sleep: async () => {},
    })

    const byShape = registry.resolve(managerNode({ shape: "house" }))
    const byType = registry.resolve(managerNode({ shape: "box", type: "stack.manager_loop" }))

    expect(byShape).toBeInstanceOf(ManagerLoopHandler)
    expect(byType).toBeInstanceOf(ManagerLoopHandler)
  })
})
