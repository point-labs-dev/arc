import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { DEFAULT_ARC_CONFIG, loadArcConfig, mergeArcConfig } from "./config"

describe("config", () => {
  it("returns defaults when config file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-config-test-"))
    try {
      const loaded = await loadArcConfig({ projectRoot: root })
      expect(loaded).toEqual(DEFAULT_ARC_CONFIG)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("merges config values with defaults", () => {
    const merged = mergeArcConfig(DEFAULT_ARC_CONFIG, {
      verification: {
        commands: ["pnpm test"],
        timeout: 45,
      },
      convergence: {
        maxAttempts: 3,
        satisfactionThreshold: 0.9,
      },
      backend: {
        mode: "pi",
      },
      approval: "required",
    })

    expect(merged.verification.commands).toEqual(["pnpm test"])
    expect(merged.verification.timeout).toBe(45)
    expect(merged.convergence.maxAttempts).toBe(3)
    expect(merged.convergence.satisfactionThreshold).toBe(0.9)
    expect(merged.backend.mode).toBe("pi")
    expect(merged.approval).toBe("required")
  })

  it("loads configuration from arc.config.yaml", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-config-file-test-"))
    try {
      await writeFile(
        join(root, "arc.config.yaml"),
        "verification:\n  timeout: 30\nbackend:\n  mode: pi\n",
        "utf8",
      )

      const loaded = await loadArcConfig({ projectRoot: root })
      expect(loaded.verification.timeout).toBe(30)
      expect(loaded.backend.mode).toBe("pi")
      expect(loaded.verification.commands).toEqual(DEFAULT_ARC_CONFIG.verification.commands)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
