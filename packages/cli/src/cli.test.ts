import { describe, expect, it } from "vitest"

import { runCli } from "./index"

describe("runCli", () => {
  it("returns help response", async () => {
    await expect(runCli(["help"]))
      .resolves.toMatchObject({ ok: true, command: "help" })
  })

  it("errors for unknown command", async () => {
    const result = await runCli(["unknown"])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Unknown command")
  })
})
