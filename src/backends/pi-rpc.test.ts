import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineContext, type GraphNode } from "../engine/index"
import { describe, expect, it } from "vitest"

import { PiRpcBackend } from "./pi-rpc"

const createNode = (): GraphNode => ({
  id: "task",
  attrs: {},
})

type LaunchCommandResolver = {
  resolveLaunchCommand(node: GraphNode): {
    command: string
    args: readonly string[]
  }
}

const resolveDefaultLaunchCommand = (node: GraphNode) => {
  const backend = new PiRpcBackend()
  return (backend as unknown as LaunchCommandResolver).resolveLaunchCommand(node)
}

const withTempScript = async (
  script: string,
  run: (scriptPath: string, dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "arc-pi-backend-test-"))
  const scriptPath = join(dir, "fake-pi.mjs")

  try {
    await writeFile(scriptPath, script, "utf8")
    await run(scriptPath, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const PROMPT_ECHO_SCRIPT = `
  process.stdin.setEncoding('utf8')
  let buffer = ''
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\\r?\\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const command = JSON.parse(line)
      if (command.type === 'prompt') {
        const message = typeof command.message === 'string' ? command.message : ''
        process.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: message } }) + '\\n')
        process.stdout.write(JSON.stringify({ type: 'message_end' }) + '\\n')
        setTimeout(() => process.exit(0), 20)
      }
    }
  })
`

describe("PiRpcBackend", () => {
  it("propagates valid node reasoning effort into default launch args", () => {
    const launch = resolveDefaultLaunchCommand({
      id: "task",
      attrs: { reasoning_effort: "medium" },
    })

    const reasoningIndex = launch.args.indexOf("--reasoning-effort")
    expect(reasoningIndex).toBeGreaterThan(-1)
    expect(launch.args[reasoningIndex + 1]).toBe("medium")
    expect(launch.args).toContain("--no-session")
  })

  it("omits reasoning effort flag when node value is absent or invalid", () => {
    const missing = resolveDefaultLaunchCommand(createNode())
    expect(missing.args).not.toContain("--reasoning-effort")

    const invalid = resolveDefaultLaunchCommand({
      id: "task",
      attrs: { reasoning_effort: "invalid" },
    })
    expect(invalid.args).not.toContain("--reasoning-effort")
  })

  it("collects text deltas from rpc events", async () => {
    await withTempScript(
      `
        process.stdin.setEncoding('utf8')
        let buffer = ''
        process.stdin.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split(/\\r?\\n/)
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const command = JSON.parse(line)
            if (command.type === 'prompt') {
              process.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'message_end' }) + '\\n')
              setTimeout(() => process.exit(0), 20)
            }
          }
        })
      `,
      async (scriptPath) => {
        const backend = new PiRpcBackend({
          timeoutMs: 1_000,
          launchCommand: () => ({
            command: process.execPath,
            args: [scriptPath],
          }),
        })

        const result = await backend.run(createNode(), "Implement feature", new PipelineContext())
        expect(result).toBe("Hello world")
      },
    )
  })

  it("interpolates $context.<key> prompt tokens using direct and context-prefixed keys", async () => {
    await withTempScript(PROMPT_ECHO_SCRIPT, async (scriptPath) => {
      const backend = new PiRpcBackend({
        timeoutMs: 1_000,
        launchCommand: () => ({
          command: process.execPath,
          args: [scriptPath],
        }),
      })

      const context = new PipelineContext({
        alpha: "A",
        "context.beta": "B",
        number_value: 42,
        bool_value: true,
      })

      const result = await backend.run(
        createNode(),
        "alpha=$context.alpha beta=$context.beta num=$context.number_value flag=$context.bool_value",
        context,
      )
      expect(result).toBe("alpha=A beta=B num=42 flag=true")
    })
  })

  it("replaces missing $context.<key> prompt tokens with empty strings", async () => {
    await withTempScript(PROMPT_ECHO_SCRIPT, async (scriptPath) => {
      const backend = new PiRpcBackend({
        timeoutMs: 1_000,
        launchCommand: () => ({
          command: process.execPath,
          args: [scriptPath],
        }),
      })

      const context = new PipelineContext({
        existing: "present",
      })

      const result = await backend.run(
        createNode(),
        "before[$context.missing] after[$context.existing] end[$context.also_missing]",
        context,
      )
      expect(result).toBe("before[] after[present] end[]")
    })
  })

  it("keeps prompt unchanged when no $context tokens are present", async () => {
    await withTempScript(PROMPT_ECHO_SCRIPT, async (scriptPath) => {
      const backend = new PiRpcBackend({
        timeoutMs: 1_000,
        launchCommand: () => ({
          command: process.execPath,
          args: [scriptPath],
        }),
      })

      const result = await backend.run(
        createNode(),
        "no interpolation in this prompt",
        new PipelineContext({
          ignored: "value",
        }),
      )

      expect(result).toBe("no interpolation in this prompt")
    })
  })

  it("returns fail outcome on timeout", async () => {
    await withTempScript(
      `
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', () => {
          // Intentionally never sending message_end.
        })
      `,
      async (scriptPath) => {
        const backend = new PiRpcBackend({
          timeoutMs: 50,
          launchCommand: () => ({
            command: process.execPath,
            args: [scriptPath],
          }),
        })

        const result = await backend.run(createNode(), "Implement feature", new PipelineContext())
        expect(typeof result).toBe("object")
        if (typeof result === "string") {
          throw new Error("expected timeout outcome")
        }

        expect(result.status).toBe("fail")
        expect(result.failure_reason).toContain("timed out")
      },
    )
  })

  it("spawns a fresh process on each run", async () => {
    await withTempScript(
      `
        import { appendFileSync } from 'node:fs'
        const logPath = process.env.ARC_PID_LOG
        if (logPath) {
          appendFileSync(logPath, String(process.pid) + '\\n')
        }

        process.stdin.setEncoding('utf8')
        let buffer = ''
        process.stdin.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split(/\\r?\\n/)
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            const command = JSON.parse(line)
            if (command.type === 'prompt') {
              process.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'ok' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'message_end' }) + '\\n')
              setTimeout(() => process.exit(0), 20)
            }
          }
        })
      `,
      async (scriptPath, dir) => {
        const pidLog = join(dir, "pids.log")
        const backend = new PiRpcBackend({
          timeoutMs: 1_000,
          launchCommand: () => ({
            command: process.execPath,
            args: [scriptPath],
          }),
        })

        const originalPidLog = process.env.ARC_PID_LOG
        process.env.ARC_PID_LOG = pidLog
        try {
          await backend.run(createNode(), "Attempt one", new PipelineContext())
          await backend.run(createNode(), "Attempt two", new PipelineContext())
        } finally {
          if (originalPidLog === undefined) {
            delete process.env.ARC_PID_LOG
          } else {
            process.env.ARC_PID_LOG = originalPidLog
          }
        }

        const lines = (await readFile(pidLog, "utf8"))
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        expect(lines).toHaveLength(2)
        expect(lines[0]).not.toBe(lines[1])
      },
    )
  })

  it("returns fail outcome when onEvent throws", async () => {
    await withTempScript(
      `
        process.stdin.setEncoding('utf8')
        let buffer = ''
        process.stdin.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split(/\\r?\\n/)
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const command = JSON.parse(line)
            if (command.type === 'prompt') {
              process.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'message_end' }) + '\\n')
              setTimeout(() => process.exit(0), 20)
            }
          }
        })
      `,
      async (scriptPath) => {
        const backend = new PiRpcBackend({
          timeoutMs: 1_000,
          launchCommand: () => ({
            command: process.execPath,
            args: [scriptPath],
          }),
          onEvent: () => {
            throw new Error("event sink failed")
          },
        })

        const result = await backend.run(createNode(), "Implement feature", new PipelineContext())
        expect(typeof result).toBe("object")
        if (typeof result === "string") {
          throw new Error("expected fail outcome")
        }

        expect(result.status).toBe("fail")
        expect(result.failure_reason).toContain("event handling failed")
        expect(result.failure_reason).toContain("event sink failed")
      },
    )
  })
})
