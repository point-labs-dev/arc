import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { WorktreeManager } from "./parallel"
import { runParallelConvergence } from "./parallel"
import type { VerificationResult } from "./model"

const PASS_VERIFICATION: VerificationResult = {
  passed: true,
  standard: {
    passed: true,
    durationMs: 5,
    commands: [
      {
        command: "npm test",
        passed: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 5,
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
    score: 0.9,
    threshold: 0.8,
    passed: true,
    rationale: "pass",
  },
}

const withProject = async (
  run: (projectRoot: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "arc-parallel-test-"))
  try {
    await writeFile(
      join(root, "SPEC.md"),
      "# Spec\n\n## Item One\nA\n\n## Item Two\nB\n\n## Item Three\nC\n",
      "utf8",
    )
    await writeFile(
      join(root, "arc.config.yaml"),
      "parallel:\n  maxSessions: 2\n  useWorktrees: true\nverification:\n  commands:\n    - \"npm test\"\n  timeout: 10\n",
      "utf8",
    )
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("runParallelConvergence", () => {
  it("runs multiple items and merges successful branches", async () => {
    await withProject(async (projectRoot) => {
      const removed: string[] = []
      const merged: string[] = []

      const manager: WorktreeManager = {
        createWorktree: async (_root, item, index) => ({
          item,
          branch: `arc/${index}`,
          path: join(projectRoot, `worktree-${index}`),
        }),
        mergeBranch: async (_root, branch) => {
          merged.push(branch)
          return { merged: true, conflict: false }
        },
        removeWorktree: async (_root, handle) => {
          removed.push(handle.branch)
        },
      }

      const convergenceRunner = vi.fn().mockResolvedValue({
        success: true,
        attemptsUsed: 1,
        message: "ok",
      })

      const result = await runParallelConvergence({
        projectRoot,
        gitClient: {
          isRepository: async () => true,
          getStatus: async () => "",
          getDiffSummary: async () => "",
          getChangedFiles: async () => [],
          commitAll: async () => undefined,
        },
        worktreeManager: manager,
        convergenceRunner,
        verificationRunner: async () => PASS_VERIFICATION,
      })

      expect(result.success).toBe(true)
      expect(result.mergedBranches).toEqual(["arc/0", "arc/1"])
      expect(merged).toEqual(["arc/0", "arc/1"])
      expect(removed).toEqual(["arc/0", "arc/1"])
      expect(convergenceRunner).toHaveBeenCalledTimes(2)
    })
  })

  it("reports failed items when branch convergence fails", async () => {
    await withProject(async (projectRoot) => {
      const manager: WorktreeManager = {
        createWorktree: async (_root, item, index) => ({
          item,
          branch: `arc/${index}`,
          path: join(projectRoot, `worktree-${index}`),
        }),
        mergeBranch: async () => ({ merged: true, conflict: false }),
        removeWorktree: async () => {},
      }

      const convergenceRunner = vi
        .fn()
        .mockResolvedValueOnce({ success: true, attemptsUsed: 1, message: "ok" })
        .mockResolvedValueOnce({ success: false, attemptsUsed: 1, message: "fail" })

      const result = await runParallelConvergence({
        projectRoot,
        gitClient: {
          isRepository: async () => true,
          getStatus: async () => "",
          getDiffSummary: async () => "",
          getChangedFiles: async () => [],
          commitAll: async () => undefined,
        },
        worktreeManager: manager,
        convergenceRunner,
        verificationRunner: async () => PASS_VERIFICATION,
      })

      expect(result.success).toBe(false)
      expect(result.failedItems).toHaveLength(1)
    })
  })
})
