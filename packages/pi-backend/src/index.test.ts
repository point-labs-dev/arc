import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineContext, type GraphNode } from "@point-labs/arc-engine"
import { describe, expect, it } from "vitest"

import { PiRpcBackend } from "./index"

const createNode = (): GraphNode => ({
  id: "task",
  attrs: {},
})

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

describe("PiRpcBackend", () => {
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
})
