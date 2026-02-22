import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { type ArcEvent, CallbackArcEventSink } from "./events"
import { type GitClient } from "./git"
import type { AttemptBackendFactory, AttemptBackendSession, VerificationResult } from "./model"
import { runConvergence } from "./convergence"

const PASS_VERIFICATION: VerificationResult = {
  passed: true,
  standard: {
    passed: true,
    durationMs: 12,
    commands: [
      {
        command: "npm test",
        passed: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 12,
      },
    ],
  },
  holdout: {
    passed: true,
    scenarioCount: 1,
    failedScenarioIds: [],
    summary: "pass",
  },
  satisfaction: {
    score: 0.92,
    threshold: 0.8,
    passed: true,
    rationale: "good",
  },
}

const FAIL_VERIFICATION: VerificationResult = {
  passed: false,
  standard: {
    passed: false,
    durationMs: 10,
    commands: [
      {
        command: "npm test",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        durationMs: 10,
      },
    ],
  },
  holdout: {
    passed: false,
    scenarioCount: 1,
    failedScenarioIds: ["auth-flow"],
    summary: "fail",
  },
  satisfaction: {
    score: 0.4,
    threshold: 0.8,
    passed: false,
    rationale: "incomplete",
  },
}

const createBackendFactory = (): AttemptBackendFactory => ({
  createFreshSession: async (): Promise<AttemptBackendSession> => ({
    run: async () => ({
      summary: "backend completed",
      rawResponse: "implemented changes",
    }),
    close: async () => {},
  }),
})

const createGitClient = (commitSpy: ReturnType<typeof vi.fn>): GitClient => ({
  isRepository: async () => true,
  getStatus: async () => "",
  getDiffSummary: async () => "",
  getChangedFiles: async () => ["src/main.ts"],
  commitAll: async (_cwd, _message) => {
    commitSpy()
    return "abc123"
  },
})

const withTempProject = async (
  configYaml: string,
  run: (projectRoot: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "arc-convergence-test-"))

  try {
    await writeFile(join(root, "SPEC.md"), "# Spec\n\n## Build thing\n", "utf8")
    await writeFile(join(root, "arc.config.yaml"), configYaml, "utf8")
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("runConvergence", () => {
  it("commits changes after successful verification", async () => {
    await withTempProject("convergence:\n  maxAttempts: 2\n", async (projectRoot) => {
      const commitSpy = vi.fn()
      const events: ArcEvent[] = []

      const result = await runConvergence({
        projectRoot,
        backendFactory: createBackendFactory(),
        gitClient: createGitClient(commitSpy),
        verificationRunner: async () => PASS_VERIFICATION,
        eventSink: new CallbackArcEventSink((event) => {
          events.push(event)
        }),
      })

      expect(result.success).toBe(true)
      expect(commitSpy).toHaveBeenCalledTimes(1)

      const stateRaw = await readFile(join(projectRoot, "progress", "state.json"), "utf8")
      const state = JSON.parse(stateRaw) as { specItemsPending: string[] }
      expect(state.specItemsPending).toEqual([])
      expect(events.some((event) => event.type === "commit")).toBe(true)
    })
  })

  it("persists learning and trips circuit breaker on repeated failure", async () => {
    await withTempProject("convergence:\n  maxAttempts: 1\n", async (projectRoot) => {
      const result = await runConvergence({
        projectRoot,
        backendFactory: createBackendFactory(),
        gitClient: createGitClient(vi.fn()),
        verificationRunner: async () => FAIL_VERIFICATION,
      })

      expect(result.success).toBe(false)

      const learning = await readFile(join(projectRoot, "progress", "attempt-001.md"), "utf8")
      expect(learning).toContain("Holdout failed")
      expect(learning).toContain("Satisfaction score")
    })
  })

  it("blocks commit when required human gate rejects", async () => {
    await withTempProject("convergence:\n  maxAttempts: 1\napproval: required\n", async (projectRoot) => {
      const commitSpy = vi.fn()
      const result = await runConvergence({
        projectRoot,
        backendFactory: createBackendFactory(),
        gitClient: createGitClient(commitSpy),
        verificationRunner: async () => PASS_VERIFICATION,
        humanGate: {
          requestApproval: async () => ({
            status: "rejected",
            reason: "needs changes",
          }),
        },
      })

      expect(result.success).toBe(false)
      expect(commitSpy).not.toHaveBeenCalled()

      const learning = await readFile(join(projectRoot, "progress", "attempt-001.md"), "utf8")
      expect(learning).toContain("Human gate rejected")
    })
  })
})
