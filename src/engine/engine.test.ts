import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { runPipeline } from "./engine/engine"
import { CallbackEventEmitter } from "./events/emitter"
import type { PipelineEvent } from "./events/events"
import { readStageTextArtifact } from "./handlers/artifacts"
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

  it("exposes deterministic artifact context keys for completed stages", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ArtifactContext {
          start [shape=Mdiamond]
          task [shape=box, prompt="run task"]
          exit [shape=Msquare]
          start -> task -> exit
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "done",
        },
      })

      expect(result.status).toBe("success")
      expect(result.context_values["artifacts.start.paths"]).toEqual({
        "status.json": join(logsRoot, "start", "status.json"),
      })
      expect(result.context_values["artifacts.task.paths"]).toEqual({
        "prompt.md": join(logsRoot, "task", "prompt.md"),
        "response.md": join(logsRoot, "task", "response.md"),
        "status.json": join(logsRoot, "task", "status.json"),
      })
      expect(result.context_values["artifacts.paths"]).toEqual({
        start: {
          "status.json": join(logsRoot, "start", "status.json"),
        },
        task: {
          "prompt.md": join(logsRoot, "task", "prompt.md"),
          "response.md": join(logsRoot, "task", "response.md"),
          "status.json": join(logsRoot, "task", "status.json"),
        },
      })
    })
  })

  it("reads previously written prompt response and status artifacts", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ArtifactReads {
          start [shape=Mdiamond]
          task [shape=box, prompt="run task"]
          exit [shape=Msquare]
          start -> task -> exit
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "done",
        },
      })

      expect(result.status).toBe("success")

      const prompt = await readStageTextArtifact(logsRoot, "task", "prompt.md")
      const response = await readStageTextArtifact(logsRoot, "task", "response.md")
      const status = await readStageTextArtifact(logsRoot, "task", "status.json")

      expect(prompt).toBe("run task")
      expect(response).toBe("done")
      expect(status).toBeDefined()
      expect(JSON.parse(status ?? "{}")).toMatchObject({
        status: "success",
      })
    })
  })

  it("applies model stylesheet rules before backend execution", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph StyledModels {
          graph [model_stylesheet="
            * { llm_model: base-model; llm_provider: anthropic; reasoning_effort: low; }
            .critical { llm_model: class-model; llm_provider: gemini; }
            .critical { llm_provider: openai; }
            #review { llm_model: id-model; reasoning_effort: medium; }
          "]
          start [shape=Mdiamond]
          implement [shape=box, class="critical", prompt="implement"]
          review [shape=box, class="critical", prompt="review", llm_provider="custom", reasoning_effort="high"]
          exit [shape=Msquare]
          start -> implement -> review -> exit
        }
      `)

      const originalImplement = graph.nodes.find((node) => node.id === "implement")
      expect(originalImplement?.attrs.llm_model).toBe("")

      const seen = new Map<
        string,
        {
          llm_model: string
          llm_provider: string
          reasoning_effort: string
        }
      >()
      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id === "implement" || node.id === "review") {
            seen.set(node.id, {
              llm_model: String(node.attrs.llm_model ?? ""),
              llm_provider: String(node.attrs.llm_provider ?? ""),
              reasoning_effort: String(node.attrs.reasoning_effort ?? ""),
            })
          }
          return "ok"
        },
      }

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: backend,
      })

      expect(result.status).toBe("success")
      expect(seen.get("implement")).toEqual({
        llm_model: "class-model",
        llm_provider: "openai",
        reasoning_effort: "low",
      })
      expect(seen.get("review")).toEqual({
        llm_model: "id-model",
        llm_provider: "custom",
        reasoning_effort: "high",
      })

      expect(originalImplement?.attrs.llm_model).toBe("")
      expect(originalImplement?.attrs.llm_provider).toBe("")
      expect(originalImplement?.attrs.reasoning_effort).toBe("high")
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

  it("restarts execution for loop_restart edges instead of failing", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph LoopRestartFlow {
          start [shape=Mdiamond]
          build [shape=box, prompt="build"]
          verify [shape=box, prompt="verify"]
          exit [shape=Msquare]

          start -> build
          build -> verify
          verify -> build [condition="outcome=fail", loop_restart=true]
          verify -> exit [condition="outcome=success"]
        }
      `)

      let verifyAttempts = 0
      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id !== "verify") {
            return {
              status: "success",
            }
          }

          verifyAttempts += 1
          if (verifyAttempts === 1) {
            return {
              status: "fail",
              failure_reason: "verification failed once",
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
      })

      expect(result.status).toBe("success")
      expect(verifyAttempts).toBe(2)
      expect(result.failure_reason ?? "").not.toContain(
        "loop_restart=true edges are not supported in this milestone implementation",
      )
    })
  })

  it("resets context-derived execution state on loop_restart", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph LoopRestartContextReset {
          start [shape=Mdiamond]
          seed [shape=box, prompt="seed"]
          gate [shape=box, prompt="gate"]
          exit [shape=Msquare]

          start -> seed
          seed -> gate
          gate -> seed [condition="outcome=fail", loop_restart=true]
          gate -> exit [condition="outcome=success"]
        }
      `)

      let seedAttempts = 0
      let gateAttempts = 0
      const backend: CodergenBackend = {
        run: async (node) => {
          if (node.id === "seed") {
            seedAttempts += 1
            if (seedAttempts === 1) {
              return {
                status: "success",
                context_updates: {
                  "first.pass.only": "stale",
                },
              }
            }

            return {
              status: "success",
            }
          }

          if (node.id === "gate") {
            gateAttempts += 1
            if (gateAttempts === 1) {
              return {
                status: "fail",
                failure_reason: "trigger restart",
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
      })

      expect(result.status).toBe("success")
      expect(gateAttempts).toBe(2)
      expect(result.completed_nodes).toEqual(["seed", "gate"])
      expect(result.context_values["first.pass.only"]).toBeUndefined()
      expect(result.context_values["artifacts.seed.dir"]).toBe(join(logsRoot, "restart-1", "seed"))
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

  it("supports loop_restart edges during parallel branch execution", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelLoopRestartBranch {
          start [shape=Mdiamond]
          parallel [shape=component, join_policy="wait_all", max_parallel=2]
          branch_a [shape=box, prompt="branch a"]
          branch_a_restart [shape=box, prompt="branch a restart"]
          branch_b [shape=box, prompt="branch b"]
          fan_in [shape=tripleoctagon]
          exit [shape=Msquare]

          start -> parallel
          parallel -> branch_a
          parallel -> branch_b
          branch_a -> branch_a_restart [loop_restart=true]
          branch_a_restart -> fan_in
          branch_b -> fan_in
          fan_in -> exit [condition="outcome=success"]
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => {
            return {
              status: "success",
            }
          },
        },
      })

      expect(result.status).toBe("success")
      expect(result.failure_reason ?? "").not.toContain(
        "loop_restart=true edges are not supported in branch execution",
      )

      const parallelResults = result.context_values["parallel.results"] as Array<{
        branch_id: string
        completed_nodes: string[]
      }>
      const restartedBranch = parallelResults.find((branchResult) => branchResult.branch_id === "branch_a")
      expect(restartedBranch?.completed_nodes).toEqual(["branch_a_restart"])
    })
  })

  it("uses lexical tie-break for equally distant fan-in candidates", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelTieBreak {
          start [shape=Mdiamond]
          parallel [shape=component, join_policy="wait_all", max_parallel=2]
          branch_a [shape=box, prompt="branch a"]
          branch_b [shape=box, prompt="branch b"]
          fan_in_alpha [shape=tripleoctagon]
          fan_in_beta [shape=tripleoctagon]
          exit [shape=Msquare]

          start -> parallel
          parallel -> branch_a
          parallel -> branch_b
          branch_a -> fan_in_alpha
          branch_a -> fan_in_beta
          branch_b -> fan_in_alpha
          branch_b -> fan_in_beta
          fan_in_alpha -> exit [condition="outcome=success"]
          fan_in_beta -> exit [condition="outcome=success"]
        }
      `)

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async () => "ok",
        },
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("success")
      expect(result.context_values["parallel.join_node"]).toBe("fan_in_alpha")
      expect(result.completed_nodes).toEqual(["start", "parallel", "fan_in_alpha"])
    })
  })

  it("keeps branch-local context updates isolated from parent context", async () => {
    await withTempLogsRoot(async (logsRoot) => {
      const graph = parseDot(`
        digraph ParallelContextIsolation {
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

      const result = await runPipeline(graph, {
        logsRoot,
        codergenBackend: {
          run: async (node) => {
            if (node.id === "branch_a") {
              return {
                status: "success",
                context_updates: {
                  score: 0.7,
                  "branch.local": "only-a",
                  "branch.a.value": "a",
                },
              }
            }

            if (node.id === "branch_b") {
              return {
                status: "partial_success",
                context_updates: {
                  score: 0.6,
                  "branch.local": "only-b",
                  "branch.b.value": "b",
                },
              }
            }

            return {
              status: "success",
            }
          },
        },
        retryBackoff: FAST_BACKOFF,
      })

      expect(result.status).toBe("success")
      expect(result.context_values["branch.local"]).toBeUndefined()
      expect(result.context_values["branch.a.value"]).toBeUndefined()
      expect(result.context_values["branch.b.value"]).toBeUndefined()

      const parallelResults = result.context_values["parallel.results"]
      expect(Array.isArray(parallelResults)).toBe(true)

      const branchLocalValues = (
        parallelResults as Array<{ outcome: { context_updates: Record<string, unknown> } }>
      )
        .map((branchResult) => branchResult.outcome.context_updates["branch.local"])
        .sort()
      expect(branchLocalValues).toEqual(["only-a", "only-b"])
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
