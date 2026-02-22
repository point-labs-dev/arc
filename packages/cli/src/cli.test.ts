import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { runCli } from "./index"

const withTempProject = async (run: (projectRoot: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "arc-cli-test-"))
  try {
    await writeFile(join(root, "SPEC.md"), "# Spec\n\n## Item A\n\n- do thing\n", "utf8")
    await mkdir(join(root, "progress"), { recursive: true })
    await run(root)
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
