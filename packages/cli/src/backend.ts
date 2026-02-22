import type { AttemptBackendFactory, AttemptBackendResponse, AttemptBackendSession } from "./model"

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
