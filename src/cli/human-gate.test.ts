import { describe, expect, it } from "vitest"

import { CommandHumanGate, createHumanGate, resolveApprovalMode } from "./human-gate"
import { DEFAULT_ARC_CONFIG } from "./config"

describe("human gate", () => {
  it("resolves approval mode from humanGate override", () => {
    const mode = resolveApprovalMode({
      ...DEFAULT_ARC_CONFIG,
      approval: "none",
      humanGate: {
        ...DEFAULT_ARC_CONFIG.humanGate,
        enabled: true,
        mode: "required",
      },
    })

    expect(mode).toBe("required")
  })

  it("parses command-based decision", async () => {
    const gate = new CommandHumanGate(
      'node -e "process.stdout.write(JSON.stringify({status:\'approved\',reason:\'discord reaction\'}))"',
    )

    const decision = await gate.requestApproval({
      attempt: 1,
      summary: "summary",
      filesChanged: ["a.ts"],
    })

    expect(decision.status).toBe("approved")
    expect(decision.reason).toContain("discord")
  })

  it("creates auto gate when approval is none", async () => {
    const gate = createHumanGate({
      ...DEFAULT_ARC_CONFIG,
      approval: "none",
      humanGate: {
        ...DEFAULT_ARC_CONFIG.humanGate,
        enabled: false,
      },
    })

    const decision = await gate.requestApproval({
      attempt: 2,
      summary: "summary",
      filesChanged: [],
    })

    expect(decision.status).toBe("approved")
  })
})
