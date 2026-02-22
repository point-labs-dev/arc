import { exec } from "node:child_process"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"

import type {
  ApprovalDecision,
  ArcProjectConfig,
  ApprovalMode,
  HumanApprovalRequest,
} from "./model"

const execAsync = promisify(exec)

export interface HumanGate {
  requestApproval(request: HumanApprovalRequest): Promise<ApprovalDecision>
}

export class AutoHumanGate implements HumanGate {
  async requestApproval(): Promise<ApprovalDecision> {
    return {
      status: "approved",
      reason: "approval disabled",
    }
  }
}

export class InteractiveHumanGate implements HumanGate {
  constructor(private readonly timeoutSeconds: number) {}

  async requestApproval(request: HumanApprovalRequest): Promise<ApprovalDecision> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return {
        status: "skipped",
        reason: "no interactive terminal",
      }
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const timer = setTimeout(() => {
      rl.close()
    }, Math.max(1, this.timeoutSeconds) * 1000)

    try {
      const answer = await rl.question(
        `Approval required for attempt ${request.attempt} (${request.filesChanged.length} files). Approve? [y/N]: `,
      )
      const normalized = answer.trim().toLowerCase()

      if (normalized === "y" || normalized === "yes") {
        return {
          status: "approved",
          reason: "approved from interactive prompt",
        }
      }

      return {
        status: "rejected",
        reason: "rejected from interactive prompt",
      }
    } catch {
      return {
        status: "skipped",
        reason: "interactive prompt timed out",
      }
    } finally {
      clearTimeout(timer)
      rl.close()
    }
  }
}

export class CommandHumanGate implements HumanGate {
  constructor(private readonly command: string) {}

  async requestApproval(request: HumanApprovalRequest): Promise<ApprovalDecision> {
    try {
      const result = await execAsync(this.command, {
        env: {
          ...process.env,
          ARC_HUMAN_GATE_REQUEST_JSON: JSON.stringify(request),
        },
        maxBuffer: 4 * 1024 * 1024,
      })

      const parsed = parseDecision(result.stdout)
      if (parsed !== undefined) {
        return parsed
      }

      return {
        status: "approved",
        reason: "command returned non-JSON output; defaulting to approve",
      }
    } catch (error) {
      return {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const createHumanGate = (config: ArcProjectConfig): HumanGate => {
  const mode = resolveApprovalMode(config)
  if (mode === "none") {
    return new AutoHumanGate()
  }

  const command = config.humanGate.command?.trim()
  if (command !== undefined && command.length > 0) {
    return new CommandHumanGate(command)
  }

  return new InteractiveHumanGate(config.humanGate.timeout)
}

export const resolveApprovalMode = (config: ArcProjectConfig): ApprovalMode => {
  if (config.humanGate.enabled) {
    return config.humanGate.mode
  }

  return config.approval
}

const parseDecision = (stdout: string): ApprovalDecision | undefined => {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== "object" || parsed === null) {
      return undefined
    }

    const status =
      parsed.status === "approved" || parsed.status === "rejected" || parsed.status === "skipped"
        ? parsed.status
        : undefined

    if (status === undefined) {
      return undefined
    }

    return {
      status,
      reason: typeof parsed.reason === "string" ? parsed.reason : "human gate command",
    }
  } catch {
    return undefined
  }
}
