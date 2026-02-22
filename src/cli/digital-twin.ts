import { exec } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"

import type { ArcProjectConfig, DigitalTwinEnvironment } from "./model"

const execAsync = promisify(exec)

export interface DigitalTwinRequest {
  readonly attempt: number
  readonly objective: string
}

export interface DigitalTwinProvider {
  provision(request: DigitalTwinRequest): Promise<DigitalTwinEnvironment>
  teardown(environment: DigitalTwinEnvironment): Promise<void>
}

export class MockDigitalTwinProvider implements DigitalTwinProvider {
  constructor(private readonly baseEndpoint: string) {}

  async provision(request: DigitalTwinRequest): Promise<DigitalTwinEnvironment> {
    const id = `mock-${request.attempt}-${randomUUID().slice(0, 8)}`

    return {
      id,
      endpoint: `${trimTrailingSlash(this.baseEndpoint)}/twin/${id}`,
      metadata: {
        objective: request.objective,
      },
    }
  }

  async teardown(): Promise<void> {}
}

export class CommandDigitalTwinProvider implements DigitalTwinProvider {
  constructor(private readonly command: string) {}

  async provision(request: DigitalTwinRequest): Promise<DigitalTwinEnvironment> {
    const result = await execAsync(this.command, {
      env: {
        ...process.env,
        ARC_TWIN_REQUEST_JSON: JSON.stringify(request),
      },
      maxBuffer: 4 * 1024 * 1024,
    })

    const parsed = parseTwinEnvironment(result.stdout)
    if (parsed === undefined) {
      throw new Error("Digital twin command did not return a valid JSON payload")
    }

    return parsed
  }

  async teardown(environment: DigitalTwinEnvironment): Promise<void> {
    await execAsync(this.command, {
      env: {
        ...process.env,
        ARC_TWIN_REQUEST_JSON: JSON.stringify({
          action: "teardown",
          environment,
        }),
      },
      maxBuffer: 4 * 1024 * 1024,
    })
  }
}

export const createDigitalTwinProvider = (config: ArcProjectConfig): DigitalTwinProvider => {
  const command = config.digitalTwin.command?.trim()
  if (command !== undefined && command.length > 0) {
    return new CommandDigitalTwinProvider(command)
  }

  return new MockDigitalTwinProvider(config.digitalTwin.endpoint)
}

const parseTwinEnvironment = (stdout: string): DigitalTwinEnvironment | undefined => {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== "object" || parsed === null) {
      return undefined
    }

    if (typeof parsed.id !== "string" || typeof parsed.endpoint !== "string") {
      return undefined
    }

    return {
      id: parsed.id,
      endpoint: parsed.endpoint,
      metadata: toStringRecord(parsed.metadata),
    }
  } catch {
    return undefined
  }
}

const toStringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown] => typeof entry[0] === "string")
      .map(([key, recordValue]) => [key, String(recordValue)]),
  )
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")
