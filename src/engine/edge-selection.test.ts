import { describe, expect, it } from "vitest"

import { PipelineContext } from "./context/context"
import { successOutcome } from "./context/outcome"
import { selectNextEdge } from "./engine/edge-selection"
import { requireNodeById } from "./graph"
import { parseDot } from "./parser"

describe("selectNextEdge", () => {
  it("prioritizes condition-matched edges over unconditional weight", () => {
    const graph = parseDot(`
      digraph ConditionWins {
        start [shape=Mdiamond]
        route [shape=diamond]
        a [shape=box, prompt="a"]
        b [shape=box, prompt="b"]
        exit [shape=Msquare]

        start -> route
        route -> a [condition="outcome=success", weight=1]
        route -> b [weight=99]
      }
    `)

    const context = new PipelineContext()
    const selected = selectNextEdge(
      requireNodeById(graph, "route"),
      successOutcome(),
      context,
      graph,
    )

    expect(selected?.to).toBe("a")
  })

  it("matches preferred labels with accelerator normalization", () => {
    const graph = parseDot(`
      digraph PreferredLabel {
        start [shape=Mdiamond]
        gate [shape=hexagon]
        approve [shape=box, prompt="approve"]
        reject [shape=box, prompt="reject"]
        exit [shape=Msquare]

        start -> gate
        gate -> approve [label="[Y] Approve"]
        gate -> reject [label="N) Reject"]
      }
    `)

    const selected = selectNextEdge(
      requireNodeById(graph, "gate"),
      successOutcome({ preferred_label: "approve" }),
      new PipelineContext(),
      graph,
    )

    expect(selected?.to).toBe("approve")
  })

  it("uses suggested_next_ids when labels do not match", () => {
    const graph = parseDot(`
      digraph SuggestedIds {
        start [shape=Mdiamond]
        gate [shape=hexagon]
        alpha [shape=box, prompt="alpha"]
        beta [shape=box, prompt="beta"]
        exit [shape=Msquare]

        start -> gate
        gate -> alpha [label="Alpha"]
        gate -> beta [label="Beta"]
      }
    `)

    const selected = selectNextEdge(
      requireNodeById(graph, "gate"),
      successOutcome({ suggested_next_ids: ["beta"] }),
      new PipelineContext(),
      graph,
    )

    expect(selected?.to).toBe("beta")
  })

  it("falls back to weight and lexical ordering", () => {
    const graph = parseDot(`
      digraph WeightLexical {
        start [shape=Mdiamond]
        route [shape=diamond]
        alpha [shape=box, prompt="alpha"]
        beta [shape=box, prompt="beta"]
        exit [shape=Msquare]

        start -> route
        route -> beta [weight=3]
        route -> alpha [weight=3]
      }
    `)

    const selected = selectNextEdge(
      requireNodeById(graph, "route"),
      successOutcome(),
      new PipelineContext(),
      graph,
    )

    expect(selected?.to).toBe("alpha")
  })

  it("returns undefined when all edges fail conditions", () => {
    const graph = parseDot(`
      digraph NoEligibleEdges {
        start [shape=Mdiamond]
        route [shape=diamond]
        alpha [shape=box, prompt="alpha"]
        beta [shape=box, prompt="beta"]
        exit [shape=Msquare]

        start -> route
        route -> alpha [condition="outcome=fail", weight=99]
        route -> beta [condition="context.force=true", weight=1]
      }
    `)

    const selected = selectNextEdge(
      requireNodeById(graph, "route"),
      successOutcome(),
      new PipelineContext(),
      graph,
    )

    expect(selected).toBeUndefined()
  })
})
