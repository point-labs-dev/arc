/**
 * LLM Service
 * 
 * Provider-agnostic LLM interface using Effect.ts.
 * Supports streaming, tool calling, and context management.
 */

import { Context, Effect, Stream, Layer, Data } from "effect"

// === Types ===

export interface Message {
  readonly role: "user" | "assistant" | "system"
  readonly content: string
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
    readonly required?: string[]
  }
}

export interface CompletionRequest {
  readonly model?: string
  readonly messages: readonly Message[]
  readonly systemPrompt?: string
  readonly tools?: readonly ToolDefinition[]
  readonly maxTokens?: number
  readonly temperature?: number
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export interface CompletionResponse {
  readonly content: string
  readonly toolCalls: readonly ToolCall[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type StreamEvent =
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "ToolCallStart"; readonly id: string; readonly name: string }
  | { readonly _tag: "ToolCallArgs"; readonly partialJson: string }
  | { readonly _tag: "ToolCallEnd"; readonly id: string }
  | { readonly _tag: "Done"; readonly usage: { inputTokens: number; outputTokens: number } }

// === Errors ===

export class LLMError extends Data.TaggedError("LLMError")<{
  readonly provider: string
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}> {}

export class LLMRateLimitError extends Data.TaggedError("LLMRateLimitError")<{
  readonly provider: string
  readonly retryAfterMs?: number
}> {}

// === Service Interface ===

export interface ILLMService {
  /**
   * Get a streaming completion
   */
  readonly stream: (
    request: CompletionRequest
  ) => Effect.Effect<Stream.Stream<StreamEvent, LLMError>, LLMError | LLMRateLimitError>

  /**
   * Get a complete response (non-streaming)
   */
  readonly complete: (
    request: CompletionRequest
  ) => Effect.Effect<CompletionResponse, LLMError | LLMRateLimitError>

  /**
   * Get current provider name
   */
  readonly provider: string
}

export class LLMService extends Context.Tag("LLMService")<LLMService, ILLMService>() {}

// === Provider Configuration ===

export interface ProviderConfig {
  readonly provider: "anthropic" | "openai"
  readonly apiKey: string
  readonly model?: string
  readonly baseUrl?: string
}

// === Collect Stream Response ===

export const collectStream = (
  stream: Stream.Stream<StreamEvent, LLMError>
): Effect.Effect<CompletionResponse, LLMError> =>
  Effect.gen(function* () {
    let content = ""
    const toolCalls: ToolCall[] = []
    let currentTool: { id: string; name: string; args: string } | null = null
    let usage = { inputTokens: 0, outputTokens: 0 }

    yield* Stream.runForEach(stream, (event) =>
      Effect.sync(() => {
        switch (event._tag) {
          case "Text":
            content += event.text
            break
          case "ToolCallStart":
            currentTool = { id: event.id, name: event.name, args: "" }
            break
          case "ToolCallArgs":
            if (currentTool) currentTool.args += event.partialJson
            break
          case "ToolCallEnd":
            if (currentTool) {
              try {
                toolCalls.push({
                  id: currentTool.id,
                  name: currentTool.name,
                  arguments: JSON.parse(currentTool.args || "{}"),
                })
              } catch {
                toolCalls.push({
                  id: currentTool.id,
                  name: currentTool.name,
                  arguments: currentTool.args,
                })
              }
              currentTool = null
            }
            break
          case "Done":
            usage = event.usage
            break
        }
      })
    )

    return { content, toolCalls, usage }
  })

// === Create Service from Config ===

export const createLLMService = (config: ProviderConfig): Effect.Effect<ILLMService> =>
  Effect.sync(() => {
    // Dynamic import based on provider
    switch (config.provider) {
      case "anthropic":
        return createAnthropicService(config)
      case "openai":
        return createOpenAIService(config)
      default:
        throw new Error(`Unknown provider: ${config.provider}`)
    }
  })

// === Anthropic Implementation ===

const createAnthropicService = (config: ProviderConfig): ILLMService => {
  const baseUrl = config.baseUrl || "https://api.anthropic.com"
  const model = config.model || "claude-sonnet-4-20250514"

  return {
    provider: "anthropic",

    stream: (request) =>
      Effect.gen(function* () {
        const response = yield* makeAnthropicRequest(baseUrl, config.apiKey, {
          ...request,
          model: request.model || model,
        })

        return parseAnthropicStream(response)
      }),

    complete: (request) =>
      Effect.gen(function* () {
        const stream = yield* makeAnthropicRequest(baseUrl, config.apiKey, {
          ...request,
          model: request.model || model,
        }).pipe(Effect.map(parseAnthropicStream))

        return yield* collectStream(stream)
      }),
  }
}

const makeAnthropicRequest = (
  baseUrl: string,
  apiKey: string,
  request: CompletionRequest
): Effect.Effect<Response, LLMError | LLMRateLimitError> =>
  Effect.gen(function* () {
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }))

    const systemPrompt = request.systemPrompt ||
      request.messages.find((m) => m.role === "system")?.content

    const body = {
      model: request.model,
      messages,
      system: systemPrompt,
      max_tokens: request.maxTokens || 8192,
      temperature: request.temperature,
      tools: request.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      stream: true,
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        }),
      catch: (e): LLMError =>
        new LLMError({
          provider: "anthropic",
          code: "REQUEST_FAILED",
          message: e instanceof Error ? e.message : "Request failed",
          retryable: true,
        }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return yield* Effect.fail(
          new LLMRateLimitError({
            provider: "anthropic",
            retryAfterMs: parseInt(response.headers.get("retry-after") || "60") * 1000,
          })
        )
      }
      return yield* Effect.fail(
        new LLMError({
          provider: "anthropic",
          code: `HTTP_${response.status}`,
          message: `HTTP ${response.status}`,
          retryable: response.status >= 500,
        })
      )
    }

    return response
  })

const parseAnthropicStream = (response: Response): Stream.Stream<StreamEvent, LLMError> =>
  Stream.async((emit) => {
    const reader = response.body?.getReader()
    if (!reader) {
      emit.fail(new LLMError({
        provider: "anthropic",
        code: "NO_BODY",
        message: "No response body",
        retryable: false,
      }))
      return
    }

    const decoder = new TextDecoder()
    let buffer = ""

    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            emit.end()
            return
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const data = line.slice(6)
            if (data === "[DONE]") continue

            try {
              const event = JSON.parse(data)
              const streamEvent = parseAnthropicEvent(event)
              if (streamEvent) emit.single(streamEvent)
            } catch {
              // Ignore parse errors
            }
          }
        }
      } catch (e) {
        emit.fail(new LLMError({
          provider: "anthropic",
          code: "STREAM_ERROR",
          message: e instanceof Error ? e.message : "Stream error",
          retryable: true,
        }))
      }
    }

    read()
  })

const parseAnthropicEvent = (event: Record<string, unknown>): StreamEvent | null => {
  const type = event.type as string

  switch (type) {
    case "content_block_start": {
      const block = event.content_block as Record<string, unknown>
      if (block.type === "tool_use") {
        return {
          _tag: "ToolCallStart",
          id: block.id as string,
          name: block.name as string,
        }
      }
      return null
    }
    case "content_block_delta": {
      const delta = event.delta as Record<string, unknown>
      if (delta.type === "text_delta") {
        return { _tag: "Text", text: delta.text as string }
      }
      if (delta.type === "input_json_delta") {
        return { _tag: "ToolCallArgs", partialJson: delta.partial_json as string }
      }
      return null
    }
    case "content_block_stop": {
      // Check for tool use end
      return null
    }
    case "message_delta": {
      const usage = event.usage as Record<string, number>
      return {
        _tag: "Done",
        usage: {
          inputTokens: usage?.input_tokens || 0,
          outputTokens: usage?.output_tokens || 0,
        },
      }
    }
    default:
      return null
  }
}

// === OpenAI Implementation (stub) ===

const createOpenAIService = (config: ProviderConfig): ILLMService => {
  const baseUrl = config.baseUrl || "https://api.openai.com"
  const model = config.model || "gpt-4o"

  return {
    provider: "openai",

    stream: (_request) =>
      Effect.fail(new LLMError({
        provider: "openai",
        code: "NOT_IMPLEMENTED",
        message: "OpenAI streaming not yet implemented",
        retryable: false,
      })),

    complete: (_request) =>
      Effect.fail(new LLMError({
        provider: "openai",
        code: "NOT_IMPLEMENTED",
        message: "OpenAI not yet implemented",
        retryable: false,
      })),
  }
}

// === Layer from Environment ===

export const LLMServiceLive: Layer.Layer<LLMService> = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const provider = (process.env.ARC_PROVIDER || "anthropic") as "anthropic" | "openai"
    const apiKey = provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error(`${provider.toUpperCase()}_API_KEY environment variable required`)
    }

    return yield* createLLMService({
      provider,
      apiKey,
      model: process.env.ARC_MODEL,
    })
  })
)
