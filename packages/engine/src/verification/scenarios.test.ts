import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import {
  HoldoutConfigurationError,
  type HoldoutEvent,
  createCommandHoldoutExecutor,
  discoverHoldoutScenarioFiles,
  parseHoldoutScenario,
  runHoldoutScenarios,
} from "./scenarios"

const LOGIN_SCENARIO = `
# Scenario: User logs in with valid credentials

## Setup
- Database has user "test@example.com"
- Server is running on port 3000

## Steps
1. POST /api/auth/login with valid credentials
2. Response should include a JWT token

## Expected
- Login succeeds
- Token is valid JWT
`

const withTempDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "arc-holdout-test-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("holdout scenarios", () => {
  it("parses a scenario markdown file", () => {
    const scenario = parseHoldoutScenario(LOGIN_SCENARIO, {
      source_path: "/tmp/auth-flow.scenario.md",
    })

    expect(scenario.name).toBe("User logs in with valid credentials")
    expect(scenario.id).toBe("user-logs-in-with-valid-credentials")
    expect(scenario.setup).toEqual([
      'Database has user "test@example.com"',
      "Server is running on port 3000",
    ])
    expect(scenario.steps).toEqual([
      "POST /api/auth/login with valid credentials",
      "Response should include a JWT token",
    ])
    expect(scenario.expected).toEqual(["Login succeeds", "Token is valid JWT"])
  })

  it("discovers scenario files recursively", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "auth-flow.scenario.md"), LOGIN_SCENARIO, "utf8")
      await mkdir(join(dir, "nested"), { recursive: true })
      await writeFile(join(dir, "nested", "edge-case.scenario.md"), LOGIN_SCENARIO, "utf8")
      await writeFile(join(dir, "README.md"), "# docs", "utf8")

      const files = await discoverHoldoutScenarioFiles(dir)
      const relativeFiles = files.map((filePath) => relative(dir, filePath))
      expect(relativeFiles).toEqual(["auth-flow.scenario.md", "nested/edge-case.scenario.md"])
    })
  })

  it("runs holdout scenarios and emits holdout events", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "auth-flow.scenario.md"), LOGIN_SCENARIO, "utf8")
      await writeFile(
        join(dir, "error-handling.scenario.md"),
        LOGIN_SCENARIO.replace("valid credentials", "invalid credentials"),
        "utf8",
      )

      const events: HoldoutEvent[] = []
      const result = await runHoldoutScenarios({
        scenarios_root: dir,
        evaluator: {
          evaluate: async (scenario) => ({
            passed: scenario.id !== "error-handling",
            summary: `Checked ${scenario.id}`,
          }),
        },
        on_event: (event) => {
          events.push(event)
        },
      })

      expect(result.passed).toBe(false)
      expect(result.scenario_count).toBe(2)
      expect(result.executed_count).toBe(2)
      expect(result.failed_scenario_ids).toEqual(["error-handling"])
      expect(events[0]?.type).toBe("holdout_start")
      expect(events.at(-1)?.type).toBe("holdout_end")
    })
  })

  it("runs holdout scenarios via command executor", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "pass.scenario.md"), LOGIN_SCENARIO, "utf8")
      await writeFile(join(dir, "fail.scenario.md"), LOGIN_SCENARIO, "utf8")

      const result = await runHoldoutScenarios({
        scenarios_root: dir,
        executor: createCommandHoldoutExecutor({
          command:
            "node -e \"const id = process.env.ARC_HOLDOUT_SCENARIO_ID ?? ''; const expected = process.env.ARC_HOLDOUT_SCENARIO_EXPECTED_JSON ?? '[]'; if (!expected.includes('Token')) { process.stderr.write('missing expected assertion'); process.exit(9); } process.stdout.write(id); process.exit(id === 'pass' ? 0 : 3)\"",
        }),
      })

      expect(result.passed).toBe(false)
      expect(result.failed_scenario_ids).toEqual(["fail"])

      const passResult = result.scenario_results.find((scenario) => scenario.scenario_id === "pass")
      const failResult = result.scenario_results.find((scenario) => scenario.scenario_id === "fail")
      expect(passResult?.passed).toBe(true)
      expect(passResult?.details).toContain("stdout:\npass")
      expect(failResult?.passed).toBe(false)
      expect(failResult?.summary).toContain("exit 3")
    })
  })

  it("rejects command executor with an empty command", () => {
    expect(() => createCommandHoldoutExecutor({ command: "   " })).toThrow(
      HoldoutConfigurationError,
    )
  })

  it("fails when scenario files are required but missing", async () => {
    await withTempDir(async (dir) => {
      const result = await runHoldoutScenarios({
        scenarios_root: dir,
        evaluator: {
          evaluate: () => ({ passed: true }),
        },
      })

      expect(result.passed).toBe(false)
      expect(result.scenario_count).toBe(0)
      expect(result.failure_reason).toContain("No holdout scenarios found")
    })
  })
})
