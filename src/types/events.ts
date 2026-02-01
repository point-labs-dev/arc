/**
 * Event Types
 * 
 * Events represent everything that happens during Ralph execution.
 * Full observability - see exactly what the agent does.
 */

import type { Step, Plan } from "./plan"

// === Iteration Events ===

export interface IterationStartEvent {
  readonly _tag: "IterationStart"
  readonly iteration: number
  readonly step: Step
  readonly timestamp: string
}

export interface IterationEndEvent {
  readonly _tag: "IterationEnd"
  readonly iteration: number
  readonly step: Step
  readonly success: boolean
  readonly duration: number
  readonly timestamp: string
}

// === LLM Events ===

export interface LLMRequestEvent {
  readonly _tag: "LLMRequest"
  readonly model: string
  readonly promptTokens: number
  readonly timestamp: string
}

export interface LLMStreamEvent {
  readonly _tag: "LLMStream"
  readonly text: string
  readonly timestamp: string
}

export interface LLMToolCallEvent {
  readonly _tag: "LLMToolCall"
  readonly tool: string
  readonly args: unknown
  readonly timestamp: string
}

export interface LLMToolResultEvent {
  readonly _tag: "LLMToolResult"
  readonly tool: string
  readonly result: string
  readonly success: boolean
  readonly timestamp: string
}

export interface LLMResponseEvent {
  readonly _tag: "LLMResponse"
  readonly completionTokens: number
  readonly totalTokens: number
  readonly cost: number
  readonly timestamp: string
}

// === File Events ===

export interface FileReadEvent {
  readonly _tag: "FileRead"
  readonly path: string
  readonly size: number
  readonly timestamp: string
}

export interface FileWriteEvent {
  readonly _tag: "FileWrite"
  readonly path: string
  readonly size: number
  readonly timestamp: string
}

export interface FileDeleteEvent {
  readonly _tag: "FileDelete"
  readonly path: string
  readonly timestamp: string
}

// === Command Events ===

export interface CommandStartEvent {
  readonly _tag: "CommandStart"
  readonly command: string
  readonly cwd: string
  readonly timestamp: string
}

export interface CommandOutputEvent {
  readonly _tag: "CommandOutput"
  readonly stream: "stdout" | "stderr"
  readonly text: string
  readonly timestamp: string
}

export interface CommandEndEvent {
  readonly _tag: "CommandEnd"
  readonly exitCode: number
  readonly duration: number
  readonly timestamp: string
}

// === Verification Events ===

export interface VerificationStartEvent {
  readonly _tag: "VerificationStart"
  readonly step: string
  readonly type: string
  readonly timestamp: string
}

export interface VerificationResultEvent {
  readonly _tag: "VerificationResult"
  readonly step: string
  readonly passed: boolean
  readonly message: string
  readonly timestamp: string
}

// === Plan Events ===

export interface PlanUpdateEvent {
  readonly _tag: "PlanUpdate"
  readonly plan: Plan
  readonly timestamp: string
}

export interface StepCompleteEvent {
  readonly _tag: "StepComplete"
  readonly step: Step
  readonly timestamp: string
}

// === Error Events ===

export interface ErrorEvent {
  readonly _tag: "Error"
  readonly message: string
  readonly code: string
  readonly recoverable: boolean
  readonly timestamp: string
}

// === Union Type ===

export type RalphEvent =
  | IterationStartEvent
  | IterationEndEvent
  | LLMRequestEvent
  | LLMStreamEvent
  | LLMToolCallEvent
  | LLMToolResultEvent
  | LLMResponseEvent
  | FileReadEvent
  | FileWriteEvent
  | FileDeleteEvent
  | CommandStartEvent
  | CommandOutputEvent
  | CommandEndEvent
  | VerificationStartEvent
  | VerificationResultEvent
  | PlanUpdateEvent
  | StepCompleteEvent
  | ErrorEvent

// === Event Emitter ===

export type EventHandler = (event: RalphEvent) => void

export interface EventEmitter {
  emit: (event: RalphEvent) => void
  on: (handler: EventHandler) => () => void
}

export const createEventEmitter = (): EventEmitter => {
  const handlers: Set<EventHandler> = new Set()

  return {
    emit: (event) => {
      for (const handler of handlers) {
        handler(event)
      }
    },
    on: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

// === Event Helpers ===

export const timestamp = (): string => new Date().toISOString()

export const iterationStart = (iteration: number, step: Step): IterationStartEvent => ({
  _tag: "IterationStart",
  iteration,
  step,
  timestamp: timestamp(),
})

export const iterationEnd = (
  iteration: number,
  step: Step,
  success: boolean,
  duration: number
): IterationEndEvent => ({
  _tag: "IterationEnd",
  iteration,
  step,
  success,
  duration,
  timestamp: timestamp(),
})

export const llmStream = (text: string): LLMStreamEvent => ({
  _tag: "LLMStream",
  text,
  timestamp: timestamp(),
})

export const error = (message: string, code: string, recoverable = true): ErrorEvent => ({
  _tag: "Error",
  message,
  code,
  recoverable,
  timestamp: timestamp(),
})
