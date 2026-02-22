import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  extractSpecItems,
  loadProgressState,
  persistAttemptLearning,
  saveProgressState,
} from "./progress"

const SPEC_TEXT = `# Arc Spec

## Convergence Loop
Details

## Holdout Scenarios
Details
`

describe("progress", () => {
  it("extracts spec section headings", () => {
    expect(extractSpecItems(SPEC_TEXT)).toEqual(["Convergence Loop", "Holdout Scenarios"])
  })

  it("loads default state when missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-progress-test-"))
    try {
      const state = await loadProgressState(root, SPEC_TEXT)
      expect(state.totalAttempts).toBe(0)
      expect(state.specItemsPending).toEqual(["Convergence Loop", "Holdout Scenarios"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("saves and reloads state", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-progress-save-test-"))
    try {
      await saveProgressState(root, {
        totalAttempts: 2,
        specItemsCompleted: ["Convergence Loop"],
        specItemsPending: ["Holdout Scenarios"],
        lastAttemptAt: "2026-02-21T00:00:00.000Z",
        overallSatisfaction: 0.7,
      })

      const reloaded = await loadProgressState(root, SPEC_TEXT)
      expect(reloaded.totalAttempts).toBe(2)
      expect(reloaded.specItemsCompleted).toEqual(["Convergence Loop"])
      expect(reloaded.specItemsPending).toEqual(["Holdout Scenarios"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("writes attempt learning markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-progress-learning-test-"))
    try {
      const path = await persistAttemptLearning(root, {
        attemptNumber: 3,
        attempted: "Convergence Loop",
        worked: ["lint passed"],
        failed: ["tests failed"],
        filesChanged: ["src/index.ts"],
        keyLearning: "Fix flaky test",
        verificationSummary: "tests failed",
        backendSummary: "updated files",
      })

      const content = await readFile(path, "utf8")
      expect(content).toContain("Attempt 3")
      expect(content).toContain("Fix flaky test")
      expect(path).toBe(join(root, "progress", "attempt-003.md"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
