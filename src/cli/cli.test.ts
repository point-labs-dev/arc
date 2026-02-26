import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { runCli } from "./index"

const withTempProject = async (
  run: (projectRoot: string, pipelinePath: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "arc-cli-test-"))
  const pipelinePath = join(root, "arc.pipeline.dot")

  try {
    await writeFile(join(root, "SPEC.md"), "# Spec\n\n## Item A\n\n- do thing\n", "utf8")
    await writeFile(
      join(root, "arc.config.yaml"),
      "backend:\n  mode: mock\nmonitoring:\n  eventsLogPath: progress/events.ndjson\n",
      "utf8",
    )
    await mkdir(join(root, "progress"), { recursive: true })
    await writeFile(
      pipelinePath,
      `digraph Simple {
        Start [shape=Mdiamond]
        Work [prompt="Implement one item"]
        Decide [prompt="Return ONLY JSON: {\\"status\\":\\"success\\",\\"context_updates\\":{\\"spec_complete\\":true}}"]
        Exit [shape=Msquare]

        Start -> Work -> Decide -> Exit
      }\n`,
      "utf8",
    )

    await run(root, pipelinePath)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("runCli", () => {
  it("returns help output", async () => {
    const result = await runCli(["help"])
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain("Arc CLI")
  })

  it("validates a pipeline", async () => {
    await withTempProject(async (_projectRoot, pipelinePath) => {
      const result = await runCli(["validate", pipelinePath])
      expect(result.ok).toBe(true)
      expect(result.stdout).toContain("Diagnostics: clean")
    })
  })

  it("runs a pipeline", async () => {
    await withTempProject(async (projectRoot, pipelinePath) => {
      const result = await runCli(["run", pipelinePath, "--project", projectRoot, "--no-approve"])
      if (!result.ok) {
        throw new Error(result.stderr ?? result.stdout)
      }
      expect(result.ok).toBe(true)
      expect(result.stdout).toContain("Status: success")
    })
  })

  it("shows status for a project", async () => {
    await withTempProject(async (projectRoot) => {
      const result = await runCli(["status", "--project", projectRoot])
      expect(result.ok).toBe(true)
      expect(result.stdout).toContain("Attempts")
    })
  })

  it("errors for unknown commands", async () => {
    const result = await runCli(["nope"])
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain("Unknown command")
  })
})
