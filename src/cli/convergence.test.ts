import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { PipelineContext, parseDot, runPipeline, validate } from "../engine/index"

describe("convergence pipeline integration", () => {
  it("parses, validates, and executes pipelines/convergence.dot", async () => {
    const dotPath = join(process.cwd(), "pipelines", "convergence.dot")
    const dot = await readFile(dotPath, "utf8")
    const graph = parseDot(dot)
    const diagnostics = validate(graph)
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")

    expect(errors).toEqual([])

    const result = await runPipeline(graph, {
      context: new PipelineContext({
        spec: "# Spec\n\n## Item\n",
        learnings: "",
        project_state: "clean",
        satisfaction_passed: false,
        spec_complete: false,
      }),
      codergenBackend: {
        run: async (node) => {
          if (node.id === "Satisfaction") {
            return {
              status: "success",
              context_updates: {
                satisfaction: 0.9,
                satisfaction_passed: true,
              },
            }
          }

          if (node.id === "MoreSpec") {
            return {
              status: "success",
              context_updates: {
                spec_complete: true,
              },
            }
          }

          return "ok"
        },
      },
      toolRunner: async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
      maxNodeExecutions: 50,
    })

    expect(result.status).toBe("success")
    expect(result.completed_nodes).toContain("Implement")
    expect(result.completed_nodes).toContain("Commit")
    expect(result.context_values.spec_complete).toBe(true)
  })
})
