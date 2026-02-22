import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { runPipeline } from "./engine/engine"
import { CallbackEventEmitter } from "./events/emitter"
import type { PipelineEvent } from "./events/events"
import type { CodergenBackend } from "./handlers/codergen"
import { QueueInterviewer } from "./interviewer"
import { parseDot } from "./parser"

const FAST_BACKOFF = {
  initialDelayMs: 0,
  backoffFactor: 1,
  maxDelayMs: 0,
  jitter: false,
} as const

const withTempLogsRoot = async (run: (logsRoot: string) => Promise<void>) => {
  const logsRoot = await mkdtemp(join(tmpdir(), "arc-engine-test-"))
  try {
    await run(logsRoot)
  } finally {
    await rm(logsRoot, { recursive: true, force: true })
  }
}

describe("runPipeline", () => {
  it("executes a linear pipeline with codergen backend", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph Linear {
          graph [goal="ship feature"]
          start [shape=Mdiamond]
          task [shape=box, prompt="Do work for $goal"]
          exit [shape=Msquare]
          start -> task -> exit
        }
      `)

      const backend: CodergenBackend = {
        run: async () => "done",
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
      })

      expect(result.status).toBe("success")
      expect(result.completed_nodes).toEqual(["start", "task"])

      const prompt = await readFile(join(logsRoot, "task", "prompt.md"), "utf8")
      expect(prompt).toContain("ship feature")
    })
  })

  it("routes through conditional branches using edge selection", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph Branch {
          start [shape=Mdiamond]
          task [shape=box, prompt="run task"]
          gate [shape=diamond]
          happy [shape=box, prompt="happy path"]
          fix [shape=box, prompt="fix path"]
          exit [shape=Msquare]

          start -> task -> gate
          gate -> happy [condition="outcome=success"]
          gate -> fix [condition="outcome=fail"]
          happy -> exit
          fix -> exit
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "ok",
        },
      })

      expect(result.status).toBe("success")
      expect(result.completed_nodes).toContain("happy")
      expect(result.completed_nodes).not.toContain("fix")
    })
  })

  it("uses wait.human choices to route to the selected branch", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph HumanGate {
          start [shape=Mdiamond]
          review_gate [shape=hexagon, label="Review"]
          ship [shape=box, prompt="ship"]
          fixes [shape=box, prompt="fix"]
          exit [shape=Msquare]

          start -> review_gate
          review_gate -> ship [label="[A] Approve"]
          review_gate -> fixes [label="[F] Fix"]
          ship -> exit
          fixes -> exit
        }
      `)

      const interviewer = new QueueInterviewer([{ value: "F" }])

      const result = await runPipeline(graph, {
        logsRoot,
        interviewer,
        codergenBackend: {
          run: async () => "ok",
        },
      })

      expect(result.status).toBe("success")
      expect(result.completed_nodes).toContain("fixes")
      expect(result.completed_nodes).not.toContain("ship")
    })
  })

  it("retries nodes that return RETRY outcomes", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph RetryFlow {
          start [shape=Mdiamond]
          flaky [shape=box, prompt="flaky", max_retries=2]
          exit [shape=Msquare]
          start -> flaky -> exit
        }
      `)

      let attempts = 0
      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id !== "flaky") {
            return "ok"
          }

          attempts += 1
          if (attempts === 1) {
            return {
              status: "retry",
              failure_reason: "transient",
            }
          }
          return {
            status: "success",
          }
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("success")
      expect(attempts).toBe(2)
    })
  })

  it("enforces goal gates and reroutes to retry_target before exiting", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph GoalGate {
          start [shape=Mdiamond]
          implement [shape=box, prompt="implement", goal_gate=true, retry_target="implement", max_retries=0]
          exit [shape=Msquare]
          start -> implement -> exit
        }
      `)

      let attempts = 0
      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id !== "implement") {
            return "ok"
          }

          attempts += 1
          if (attempts === 1) {
            return {
              status: "fail",
              failure_reason: "needs retry",
            }
          }
          return {
            status: "success",
          }
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("success")
      expect(attempts).toBe(2)
      expect(result.completed_nodes.filter((nodeId) => nodeId === "implement")).toHaveLength(2)
    })
  })

  it("evaluates satisfaction at terminal completion using command-backed judge", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph SatisfactionPass {
          start [shape=Mdiamond]
          implement [shape=box, prompt="implement"]
          exit [shape=Msquare]
          start -> implement -> exit
        }
      `)

      const events: PipelineEvent[] = []
      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "ok",
        },
        eventEmitter: new CallbackEventEmitter((event) => {
          events.push(event)
        }),
        satisfaction: {
          input: {
            spec_text: "Ship feature with audit logging",
            implementation_summary: "Feature shipped and audit logging added",
            standard_verification_passed: true,
            holdout: {
              passed: true,
              scenario_count: 2,
              failed_scenario_ids: [],
            },
          },
          threshold: 0.8,
          command_judge: {
            command:
              'node -e "process.stdout.write(\'{\\"score\\":0.91,\\"rationale\\":\\"runtime judge approved implementation\\"}\')"',
          },
        },
      })

      expect(result.status).toBe("success")
      expect(result.context_values["verification.satisfaction.passed"]).toBe(true)
      expect(result.context_values["verification.satisfaction.score"]).toBe(0.91)
      expect(result.context_values["verification.satisfaction.threshold"]).toBe(0.8)

      const satisfactionEvent = events.find((event) => event.type === "satisfaction_score")
      expect(satisfactionEvent).toEqual({
        type: "satisfaction_score",
        score: 0.91,
        threshold: 0.8,
        passed: true,
        rationale: "runtime judge approved implementation",
      })
    })
  })

  it("fails pipeline when satisfaction score does not meet the threshold", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph SatisfactionFail {
          start [shape=Mdiamond]
          implement [shape=box, prompt="implement"]
          exit [shape=Msquare]
          start -> implement -> exit
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "ok",
        },
        satisfaction: {
          input: {
            spec_text: "Ship feature with strict validation",
            implementation_summary: "Validation is incomplete",
            standard_verification_passed: true,
            holdout: {
              passed: true,
              scenario_count: 1,
              failed_scenario_ids: [],
            },
          },
          threshold: 0.85,
          command_judge: {
            command:
              'node -e "process.stdout.write(\'{\\"score\\":0.4,\\"rationale\\":\\"missing validation paths\\"}\')"',
          },
        },
      })

      expect(result.status).toBe("fail")
      expect(result.failure_reason).toContain("Satisfaction score 0.400 below threshold 0.850")
      expect(result.context_values["verification.satisfaction.passed"]).toBe(false)
      expect(result.context_values["verification.satisfaction.score"]).toBe(0.4)
    })
  })

  it("saves checkpoints and resumes from checkpoint state", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ResumeFlow {
          start [shape=Mdiamond]
          a [shape=box, prompt="a"]
          b [shape=box, prompt="b"]
          exit [shape=Msquare]
          start -> a -> b -> exit
        }
      `)

      const backend: CodergenBackend = {
        run: async () => "ok",
      }

      const interrupted = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        maxNodeExecutions: 2,
      })

      expect(interrupted.status).toBe("interrupted")
      expect(interrupted.completed_nodes).toEqual(["start", "a"])

      const resumed = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        resumeFromCheckpoint: true,
      })

      expect(resumed.status).toBe("success")
      expect(resumed.completed_nodes).toEqual(["start", "a", "b"])
    })
  })

  it("executes parallel fan-out and fan-in selection", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelFlow {
          start [shape=Mdiamond]
          parallel [shape=component, join_policy="wait_all", max_parallel=2]
          branch_a [shape=box, prompt="branch a"]
          branch_b [shape=box, prompt="branch b"]
          fan_in [shape=tripleoctagon]
          exit [shape=Msquare]

          start -> parallel
          parallel -> branch_a
          parallel -> branch_b
          branch_a -> fan_in
          branch_b -> fan_in
          fan_in -> exit [condition="outcome=success"]
        }
      `)

      const calls: string[] = []
      const backend: CodergenBackend = {
        run: async (node) => {
          calls.push(node.id)
          if (node.id === "branch_a") {
            return {
              status: "success",
              context_updates: {
                score: 0.4,
              },
            }
          }
          if (node.id === "branch_b") {
            return {
              status: "partial_success",
              context_updates: {
                score: 0.9,
              },
            }
          }
          return {
            status: "success",
          }
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("success")
      expect(calls).toContain("branch_a")
      expect(calls).toContain("branch_b")
      expect(result.completed_nodes).toEqual(["start", "parallel", "fan_in"])
      expect(result.context_values["parallel.fan_in.best_id"]).toBe("branch_a")

      const parallelResults = result.context_values["parallel.results"]
      expect(Array.isArray(parallelResults)).toBe(true)
      expect((parallelResults as unknown[]).length).toBe(2)
    })
  })

  it("emits retry lifecycle events for parallel branch retries", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelRetryEvents {
          start [shape=Mdiamond]
          parallel [shape=component, join_policy="wait_all", max_parallel=2]
          branch_a [shape=box, prompt="branch a", max_retries=1]
          branch_b [shape=box, prompt="branch b"]
          fan_in [shape=tripleoctagon]
          exit [shape=Msquare]

          start -> parallel
          parallel -> branch_a
          parallel -> branch_b
          branch_a -> fan_in
          branch_b -> fan_in
          fan_in -> exit [condition="outcome=success"]
        }
      `)

      const events: PipelineEvent[] = []
      let branchAttempts = 0

      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id === "branch_a") {
            branchAttempts += 1
            if (branchAttempts === 1) {
              return {
                status: "retry",
                failure_reason: "transient branch failure",
              }
            }

            return {
              status: "success",
            }
          }

          return {
            status: "success",
          }
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        retryBackoff: FAST_BACKOFF,
        eventEmitter: new CallbackEventEmitter((event) => {
          events.push(event)
        }),
      })

      expect(result.status).toBe("success")
      expect(branchAttempts).toBe(2)
      expect(
        events.some(
          (event) =>
            event.type === "stage_failed" &&
            event.node_id === "branch_a" &&
            event.attempt === 1 &&
            event.will_retry,
        ),
      ).toBe(true)
      expect(
        events.some(
          (event) =>
            event.type === "stage_retrying" && event.node_id === "branch_a" && event.attempt === 1,
        ),
      ).toBe(true)
      expect(
        events.some(
          (event) =>
            event.type === "stage_completed" &&
            event.node_id === "branch_a" &&
            event.attempt === 2 &&
            event.status === "success",
        ),
      ).toBe(true)
    })
  })

  it("fails pipeline when all parallel branches fail and no eligible edge exists", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelAllFail {
          start [shape=Mdiamond]
          parallel [shape=component, join_policy="wait_all", max_parallel=2]
          branch_a [shape=box, prompt="branch a"]
          branch_b [shape=box, prompt="branch b"]
          fan_in [shape=tripleoctagon]
          exit [shape=Msquare]

          start -> parallel
          parallel -> branch_a
          parallel -> branch_b
          branch_a -> fan_in
          branch_b -> fan_in
          fan_in -> exit [condition="outcome=success"]
        }
      `)

      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id === "branch_a" || node.id === "branch_b") {
            return {
              status: "fail",
              failure_reason: `branch ${node.id} failed`,
            }
          }
          return {
            status: "success",
          }
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("fail")
      expect(result.node_outcomes.fan_in?.status).toBe("fail")
      expect(result.node_outcomes.fan_in?.failure_reason).toContain("All parallel branches failed")
      expect(result.failure_reason).toContain("All parallel branches failed")
    })
  })
})
