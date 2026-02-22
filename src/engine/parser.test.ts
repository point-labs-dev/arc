import { describe, expect, it } from "vitest"

import { parseDot } from "./parser"
import type { DurationValue, GraphDefinition } from "./types"

const nodeById = (graph: GraphDefinition, nodeId: string) => {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  expect(node).toBeDefined()
  return node!
}

const durationRaw = (value: unknown): string => {
  if (typeof value === "object" && value !== null && "raw" in value) {
    return (value as DurationValue).raw
  }
  throw new Error("Expected duration value")
}

describe("parseDot", () => {
  it("parses the Section 2.13 simple linear workflow", () => {
    const graph = parseDot(`
      digraph Simple {
          graph [goal="Run tests and report"]
          rankdir=LR

          start [shape=Mdiamond, label="Start"]
          exit  [shape=Msquare, label="Exit"]

          run_tests [label="Run Tests", prompt="Run the test suite and report results"]
          report    [label="Report", prompt="Summarize the test results"]

          start -> run_tests -> report -> exit
      }
    `)

    expect(graph.id).toBe("Simple")
    expect(graph.attrs.goal).toBe("Run tests and report")
    expect(graph.attrs.rankdir).toBe("LR")
    expect(graph.nodes).toHaveLength(4)
    expect(graph.edges).toHaveLength(3)
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["start", "run_tests"],
      ["run_tests", "report"],
      ["report", "exit"],
    ])
  })

  it("parses the Section 2.13 branching workflow with defaults and conditions", () => {
    const graph = parseDot(`
      digraph Branch {
          graph [goal="Implement and validate a feature"]
          rankdir=LR
          node [shape=box, timeout="900s"]

          start     [shape=Mdiamond, label="Start"]
          exit      [shape=Msquare, label="Exit"]
          plan      [label="Plan", prompt="Plan the implementation"]
          implement [label="Implement", prompt="Implement the plan"]
          validate  [label="Validate", prompt="Run tests"]
          gate      [shape=diamond, label="Tests passing?"]

          start -> plan -> implement -> validate -> gate
          gate -> exit      [label="Yes", condition="outcome=success"]
          gate -> implement [label="No", condition="outcome!=success"]
      }
    `)

    expect(graph.edges).toHaveLength(6)
    expect(durationRaw(nodeById(graph, "plan").attrs.timeout)).toBe("900s")
    expect(nodeById(graph, "gate").attrs.shape).toBe("diamond")
    expect(graph.edges[4].attrs.condition).toBe("outcome=success")
    expect(graph.edges[5].attrs.condition).toBe("outcome!=success")
  })

  it("parses the Section 2.13 human gate workflow", () => {
    const graph = parseDot(`
      digraph Review {
          rankdir=LR

          start [shape=Mdiamond, label="Start"]
          exit  [shape=Msquare, label="Exit"]

          review_gate [
              shape=hexagon,
              label="Review Changes",
              type="wait.human"
          ]

          start -> review_gate
          review_gate -> ship_it [label="[A] Approve"]
          review_gate -> fixes   [label="[F] Fix"]
          ship_it -> exit
          fixes -> review_gate
      }
    `)

    expect(graph.nodes).toHaveLength(3)
    expect(nodeById(graph, "review_gate").attrs.type).toBe("wait.human")
    expect(graph.edges.map((edge) => edge.attrs.label)).toEqual([
      "",
      "[A] Approve",
      "[F] Fix",
      "",
      "",
    ])
  })

  it("flattens subgraphs, applies scoped defaults, derives classes, and strips comments", () => {
    const graph = parseDot(`
      digraph SubgraphScope {
          // Global defaults
          node [shape=box, timeout=300s]

          /* Subgraph should be flattened */
          subgraph cluster_loop {
              label = "Loop A"
              node [thread_id="loop-a"]

              Plan [label="Plan next step"]
              Implement [label="Implement", class="critical", timeout="1800s"]
              Plan -> Implement [label="next"]
          }
      }
    `)

    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)

    const plan = nodeById(graph, "Plan")
    const implement = nodeById(graph, "Implement")

    expect(plan.attrs.thread_id).toBe("loop-a")
    expect(durationRaw(plan.attrs.timeout)).toBe("300s")
    expect(plan.attrs.class).toBe("loop-a")

    expect(durationRaw(implement.attrs.timeout)).toBe("1800s")
    expect(implement.attrs.class).toBe("critical,loop-a")
  })

  it("applies node and edge defaults to subsequent declarations and chained edges", () => {
    const graph = parseDot(`
      digraph Defaults {
          node [shape=box, prompt="default prompt"]
          edge [weight=7]

          A
          B [prompt="custom prompt"]
          C

          A -> B -> C [label="next"]
      }
    `)

    expect(nodeById(graph, "A").attrs.prompt).toBe("default prompt")
    expect(nodeById(graph, "B").attrs.prompt).toBe("custom prompt")
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0].attrs.weight).toBe(7)
    expect(graph.edges[1].attrs.weight).toBe(7)
    expect(graph.edges[0].attrs.label).toBe("next")
    expect(graph.edges[1].attrs.label).toBe("next")
  })

  it("rejects missing commas in an attribute block", () => {
    expect(() =>
      parseDot(`
        digraph Invalid {
            node_a [label="A" prompt="missing comma"]
        }
      `),
    ).toThrow(/comma-separated/i)
  })

  it("rejects undirected edges and non-digraph inputs", () => {
    expect(() =>
      parseDot(`
        digraph Invalid {
            a -- b
        }
      `),
    ).toThrow(/Undirected edges/)

    expect(() =>
      parseDot(`
        graph Invalid {
            a -- b
        }
      `),
    ).toThrow(/digraph/i)
  })
})
