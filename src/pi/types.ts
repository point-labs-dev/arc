/**
 * Pi Event Types
 * 
 * Types for Pi's JSON mode output events.
 * These mirror the events Pi emits when run with --mode json
 */

// === Stream Events ===

export interface PiStartEvent {
  readonly type: 'start'
  readonly model: string
  readonly provider: string
}

export interface PiTextStartEvent {
  readonly type: 'text_start'
  readonly contentIndex: number
}

export interface PiTextDeltaEvent {
  readonly type: 'text_delta'
  readonly delta: string
  readonly contentIndex: number
}

export interface PiTextEndEvent {
  readonly type: 'text_end'
  readonly content: string
  readonly contentIndex: number
}

export interface PiThinkingStartEvent {
  readonly type: 'thinking_start'
  readonly contentIndex: number
}

export interface PiThinkingDeltaEvent {
  readonly type: 'thinking_delta'
  readonly delta: string
  readonly contentIndex: number
}

export interface PiThinkingEndEvent {
  readonly type: 'thinking_end'
  readonly content: string
  readonly contentIndex: number
}

export interface PiToolCallStartEvent {
  readonly type: 'toolcall_start'
  readonly contentIndex: number
  readonly name: string
}

export interface PiToolCallDeltaEvent {
  readonly type: 'toolcall_delta'
  readonly contentIndex: number
  readonly delta: string
}

export interface PiToolCallEndEvent {
  readonly type: 'toolcall_end'
  readonly contentIndex: number
  readonly toolCall: {
    readonly id: string
    readonly name: string
    readonly arguments: Record<string, unknown>
  }
}

export interface PiToolResultEvent {
  readonly type: 'tool_result'
  readonly toolCallId: string
  readonly toolName: string
  readonly output: string
  readonly isError: boolean
}

export interface PiDoneEvent {
  readonly type: 'done'
  readonly reason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  readonly usage?: {
    readonly input: number
    readonly output: number
    readonly cost: {
      readonly input: number
      readonly output: number
      readonly total: number
    }
  }
}

export interface PiErrorEvent {
  readonly type: 'error'
  readonly reason: 'error' | 'aborted'
  readonly message: string
}

// === Union Type ===

export type PiEvent =
  | PiStartEvent
  | PiTextStartEvent
  | PiTextDeltaEvent
  | PiTextEndEvent
  | PiThinkingStartEvent
  | PiThinkingDeltaEvent
  | PiThinkingEndEvent
  | PiToolCallStartEvent
  | PiToolCallDeltaEvent
  | PiToolCallEndEvent
  | PiToolResultEvent
  | PiDoneEvent
  | PiErrorEvent

// === Runner Config ===

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface PiRunnerConfig {
  /** Thinking/reasoning level */
  readonly thinking?: ThinkingLevel
  /** LLM provider (anthropic, openai, google, etc.) */
  readonly provider?: string
  /** Model ID */
  readonly model?: string
  /** Timeout in milliseconds */
  readonly timeout?: number
  /** Working directory for Pi */
  readonly cwd?: string
  /** Additional environment variables */
  readonly env?: Record<string, string>
  /** Tools to enable (default: read,write,edit,bash) */
  readonly tools?: string[]
}

// === Execution Result ===

export interface PiExecutionResult {
  readonly success: boolean
  readonly events: PiEvent[]
  readonly output: string
  readonly toolCalls: Array<{
    readonly name: string
    readonly arguments: Record<string, unknown>
    readonly result: string
    readonly isError: boolean
  }>
  readonly usage?: {
    readonly input: number
    readonly output: number
    readonly cost: number
  }
  readonly error?: string
}
