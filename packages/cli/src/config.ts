import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { parse } from "yaml"

import type { ArcProjectConfig, BackendMode } from "./model"

export const DEFAULT_ARC_CONFIG: ArcProjectConfig = {
  verification: {
    commands: ["npm run typecheck", "npm run test", "npm run lint"],
    timeout: 120,
  },
  convergence: {
    maxAttempts: 10,
    satisfactionThreshold: 0.8,
    freshContextPerAttempt: true,
  },
  model: {
    default: "claude-sonnet-4-20250514",
    planning: "claude-opus-4-0-20250514",
    satisfaction: "claude-opus-4-0-20250514",
    provider: "anthropic",
  },
  approval: "optional",
  parallel: {
    maxSessions: 3,
    useWorktrees: true,
  },
  monitoring: {
    discordChannel: "#arc",
    progressInterval: 300,
    eventsLogPath: "progress/events.ndjson",
  },
  backend: {
    mode: "mock",
    timeout: 1800,
  },
  humanGate: {
    enabled: false,
    mode: "optional",
  },
  digitalTwin: {
    enabled: false,
    provider: "mock",
    endpoint: "http://127.0.0.1:8787",
  },
}

export interface LoadArcConfigOptions {
  readonly projectRoot: string
  readonly configPath?: string
}

export const loadArcConfig = async (options: LoadArcConfigOptions): Promise<ArcProjectConfig> => {
  const configPath = options.configPath ?? join(options.projectRoot, "arc.config.yaml")
  const raw = await safeReadFile(configPath)
  if (raw === undefined) {
    return DEFAULT_ARC_CONFIG
  }

  const parsed = parse(raw)
  return mergeArcConfig(DEFAULT_ARC_CONFIG, parsed)
}

export const mergeArcConfig = (base: ArcProjectConfig, raw: unknown): ArcProjectConfig => {
  const root = asRecord(raw)

  const verificationNode = asRecord(root.verification)
  const convergenceNode = asRecord(root.convergence)
  const modelNode = asRecord(root.model)
  const parallelNode = asRecord(root.parallel)
  const monitoringNode = asRecord(root.monitoring)
  const backendNode = asRecord(root.backend)
  const humanGateNode = asRecord(root.humanGate)
  const digitalTwinNode = asRecord(root.digitalTwin)

  const commands = asStringList(verificationNode.commands)
  const mode = asBackendMode(backendNode.mode)
  const approval = asApprovalMode(root.approval)
  const humanMode = asApprovalMode(humanGateNode.mode)

  return {
    verification: {
      commands: commands.length > 0 ? commands : base.verification.commands,
      timeout: asPositiveNumber(verificationNode.timeout, base.verification.timeout),
      holdout_command: asOptionalString(verificationNode.holdout_command),
      holdout_timeout: asOptionalPositiveNumber(verificationNode.holdout_timeout),
    },
    convergence: {
      maxAttempts: asPositiveInteger(convergenceNode.maxAttempts, base.convergence.maxAttempts),
      satisfactionThreshold: clamp01(
        asNumber(convergenceNode.satisfactionThreshold, base.convergence.satisfactionThreshold),
      ),
      freshContextPerAttempt: asBoolean(
        convergenceNode.freshContextPerAttempt,
        base.convergence.freshContextPerAttempt,
      ),
    },
    model: {
      default: asString(modelNode.default, base.model.default),
      planning: asString(modelNode.planning, base.model.planning),
      satisfaction: asString(modelNode.satisfaction, base.model.satisfaction),
      provider: asString(modelNode.provider, base.model.provider),
    },
    approval,
    parallel: {
      maxSessions: asPositiveInteger(parallelNode.maxSessions, base.parallel.maxSessions),
      useWorktrees: asBoolean(parallelNode.useWorktrees, base.parallel.useWorktrees),
    },
    monitoring: {
      discordChannel: asString(monitoringNode.discordChannel, base.monitoring.discordChannel),
      progressInterval: asPositiveNumber(
        monitoringNode.progressInterval,
        base.monitoring.progressInterval,
      ),
      eventsLogPath: asString(monitoringNode.eventsLogPath, base.monitoring.eventsLogPath),
    },
    backend: {
      mode: mode ?? base.backend.mode,
      timeout: asPositiveNumber(backendNode.timeout, base.backend.timeout),
    },
    humanGate: {
      enabled: asBoolean(humanGateNode.enabled, base.humanGate.enabled),
      mode: humanMode,
    },
    digitalTwin: {
      enabled: asBoolean(digitalTwinNode.enabled, base.digitalTwin.enabled),
      provider: asString(digitalTwinNode.provider, base.digitalTwin.provider),
      endpoint: asString(digitalTwinNode.endpoint, base.digitalTwin.endpoint),
    },
  }
}

const safeReadFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }
    throw error
  }
}

const isMissingFileError = (value: unknown): value is NodeJS.ErrnoException =>
  typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT"

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

const asString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const asStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
}

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback
  }
  return value
}

const asPositiveNumber = (value: unknown, fallback: number): number => {
  const parsed = asNumber(value, fallback)
  return parsed > 0 ? parsed : fallback
}

const asOptionalPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return undefined
  }
  return value
}

const asPositiveInteger = (value: unknown, fallback: number): number =>
  Math.max(1, Math.floor(asPositiveNumber(value, fallback)))

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value !== "boolean") {
    return fallback
  }
  return value
}

const asApprovalMode = (value: unknown): ArcProjectConfig["approval"] => {
  if (value === "required" || value === "optional" || value === "none") {
    return value
  }

  return "optional"
}

const asBackendMode = (value: unknown): BackendMode | undefined => {
  if (value === "pi" || value === "mock") {
    return value
  }
  return undefined
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
