import { describe, expect, it } from "vitest"

import { parseDot } from "./parser"
import {
  parseConditionExpression,
  validate,
  validateOrRaise,
  validateStylesheetSyntax,
} from "./validation"

const errorForRule = (diagnostics: ReturnType<typeof validate>, rule: string) =>
  diagnostics.find((diagnostic) => diagnostic.rule === rule && diagnostic.severity === "ERROR")

describe("validate", () => {
  it("accepts a valid simple pipeline", () => {
    const graph = parseDot(`
      digraph Valid {
          start [shape=Mdiamond]
          task [shape=box, prompt="Do the work"]
          exit [shape=Msquare]
          start -> task -> exit
      }
    `)

    const diagnostics = validate(graph)
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")).toHaveLength(0)
  })

  it("reports missing start node", () => {
    const graph = parseDot(`
      digraph MissingStart {
          plan [shape=box, prompt="Plan it"]
          exit [shape=Msquare]
          plan -> exit
      }
    `)

    const diagnostics = validate(graph)
    expect(errorForRule(diagnostics, "start_node")).toBeDefined()
  })

  it("reports missing terminal node", () => {
    const graph = parseDot(`
      digraph MissingTerminal {
          start [shape=Mdiamond]
          plan [shape=box, prompt="Plan it"]
          start -> plan
      }
    `)

    const diagnostics = validate(graph)
    expect(errorForRule(diagnostics, "terminal_node")).toBeDefined()
  })

  it("reports start node with incoming edges", () => {
    const graph = parseDot(`
      digraph IncomingToStart {
          start [shape=Mdiamond]
          plan [shape=box, prompt="Plan it"]
          exit [shape=Msquare]
          plan -> start
          start -> exit
      }
    `)

    const diagnostics = validate(graph)
    expect(errorForRule(diagnostics, "start_no_incoming")).toBeDefined()
  })

  it("reports terminal node with outgoing edges", () => {
    const graph = parseDot(`
      digraph OutgoingFromExit {
          start [shape=Mdiamond]
          plan [shape=box, prompt="Plan it"]
          exit [shape=Msquare]
          start -> plan -> exit
          exit -> plan
      }
    `)

    const diagnostics = validate(graph)
    expect(errorForRule(diagnostics, "exit_no_outgoing")).toBeDefined()
  })

  it("reports unreachable nodes", () => {
    const graph = parseDot(`
      digraph Reachability {
          start [shape=Mdiamond]
          plan [shape=box, prompt="Plan it"]
          orphan [shape=box, prompt="Orphan"]
          exit [shape=Msquare]
          start -> plan -> exit
      }
    `)

    const diagnostics = validate(graph)
    const reachabilityErrors = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "reachability",
    )
    expect(reachabilityErrors).toHaveLength(1)
    expect(reachabilityErrors[0].node_id).toBe("orphan")
  })

  it("reports edges that target missing nodes", () => {
    const graph = parseDot(`
      digraph MissingEdgeTarget {
          start [shape=Mdiamond]
          exit [shape=Msquare]
          start -> missing
      }
    `)

    const diagnostics = validate(graph)
    const edgeTargetError = errorForRule(diagnostics, "edge_target_exists")
    expect(edgeTargetError).toBeDefined()
    expect(edgeTargetError?.edge).toEqual(["start", "missing"])
  })

  it("reports invalid condition syntax", () => {
    const graph = parseDot(`
      digraph InvalidCondition {
          start [shape=Mdiamond]
          plan [shape=box, prompt="Plan it"]
          exit [shape=Msquare]
          start -> plan
          plan -> exit [condition="outcome>success"]
      }
    `)

    const diagnostics = validate(graph)
    expect(errorForRule(diagnostics, "condition_syntax")).toBeDefined()
  })

  it("throws in validateOrRaise when error diagnostics exist", () => {
    const graph = parseDot(`
      digraph Invalid {
          step [shape=box, prompt="Do thing"]
      }
    `)

    expect(() => validateOrRaise(graph)).toThrow(/Validation failed/)
  })

  it("emits warnings for type/fidelity/retry/prompt lint rules", () => {
    const graph = parseDot(`
      digraph WarningRules {
          graph [default_fidelity="invalid_mode", retry_target="missing_node"]
          start [shape=Mdiamond]
          worker [shape=box, goal_gate=true]
          unknown_handler [shape=box, type="custom.unknown", prompt="Known prompt"]
          exit [shape=Msquare]
          start -> worker [fidelity="wrong"]
          start -> unknown_handler
          worker -> exit [condition="outcome=success"]
          unknown_handler -> exit
      }
    `)

    const diagnostics = validate(graph)
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "WARNING")
    const rules = warnings.map((diagnostic) => diagnostic.rule)

    expect(rules).toContain("type_known")
    expect(rules).toContain("fidelity_valid")
    expect(rules).toContain("retry_target_exists")
    expect(rules).toContain("goal_gate_has_retry")
    expect(rules).toContain("prompt_on_llm_nodes")
  })
})

describe("condition parser", () => {
  it("parses valid condition expressions from Section 10", () => {
    const clauses = parseConditionExpression(
      'outcome=success && context.tests_passed=true && preferred_label="Ship"',
    )
    expect(clauses).toHaveLength(3)
    expect(clauses[0]).toEqual({
      key: "outcome",
      operator: "=",
      literal: "success",
    })
  })

  it("rejects unsupported keys and malformed clauses", () => {
    expect(() => parseConditionExpression("context.bad-key=true")).toThrow(
      /Unsupported condition key/,
    )
    expect(() => parseConditionExpression("outcome")).toThrow(/must contain/)
  })
})

describe("stylesheet syntax", () => {
  it("accepts valid stylesheet syntax", () => {
    expect(() =>
      validateStylesheetSyntax(`
        * { llm_provider: "openai"; }
        .critical { llm_model: "o3"; reasoning_effort: high; }
        #review { llm_model: "o3-mini"; }
      `),
    ).not.toThrow()
  })

  it("rejects malformed stylesheet syntax", () => {
    expect(() => validateStylesheetSyntax(`.critical { bad_prop: x; }`)).toThrow(
      /Unknown stylesheet/,
    )
    expect(() => validateStylesheetSyntax(`.critical llm_model: x;`)).toThrow(/Expected '\{'/)
  })
})
