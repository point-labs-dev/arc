import { PipelineContext, type GraphNode } from "../engine/index"
import { PiRpcBackend } from "../backends/pi-rpc"

import type {
  ArcProjectConfig,
  AttemptBackendFactory,
  AttemptBackendResponse,
  AttemptBackendSession,
} from "./model"

export interface MockBackendFactoryOptions {
  readonly responseText?: string
}

export class MockBackendFactory implements AttemptBackendFactory {
  private sequence = 0
  private readonly responseText: string

  constructor(options: MockBackendFactoryOptions = {}) {
    this.responseText =
      options.responseText ??
      process.env.ARC_MOCK_BACKEND_RESPONSE ??
      "Implemented incremental updates and prepared verification."
  }

  async createFreshSession(): Promise<AttemptBackendSession> {
    this.sequence += 1
    const sessionId = this.sequence

    return {
      run: async (_prompt): Promise<AttemptBackendResponse> => ({
        summary: `mock-session-${sessionId}: ${this.responseText}`,
        rawResponse: this.responseText,
      }),
      close: async () => {},
    }
  }
}

export const createBackendFactory = (config: ArcProjectConfig): AttemptBackendFactory => {
  if (config.backend.mode === "pi") {
    return new PiBackendFactory(config)
  }

  return new MockBackendFactory()
}

class PiBackendFactory implements AttemptBackendFactory {
  constructor(private readonly config: ArcProjectConfig) {}

  async createFreshSession(): Promise<AttemptBackendSession> {
    const backend = new PiRpcBackend({
      defaultModel: this.config.model.default,
      defaultProvider: this.config.model.provider,
      timeoutMs: Math.floor(this.config.backend.timeout * 1000),
    })

    return {
      run: async (prompt): Promise<AttemptBackendResponse> => {
        const node = createBackendNode(this.config)
        const context = new PipelineContext()
        const result = await backend.run(node, prompt, context)

        if (typeof result !== "string") {
          throw new Error(result.failure_reason || "Pi backend returned non-success outcome")
        }

        return {
          summary: summarizeResponse(result),
          rawResponse: result,
        }
      },
      close: async () => {},
    }
  }
}

const createBackendNode = (config: ArcProjectConfig): GraphNode => ({
  id: "arc-attempt",
  attrs: {
    shape: "box",
    llm_model: config.model.default,
    llm_provider: config.model.provider,
  },
})

const summarizeResponse = (response: string): string => {
  const firstLine = response
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine === undefined ? "Pi session completed" : firstLine
}
