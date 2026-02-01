/**
 * Pi Integration Module
 * 
 * Provides typed interface for spawning and controlling Pi coding agent.
 */

// Types
export type {
  PiEvent,
  PiStartEvent,
  PiTextStartEvent,
  PiTextDeltaEvent,
  PiTextEndEvent,
  PiThinkingStartEvent,
  PiThinkingDeltaEvent,
  PiThinkingEndEvent,
  PiToolCallStartEvent,
  PiToolCallDeltaEvent,
  PiToolCallEndEvent,
  PiToolResultEvent,
  PiDoneEvent,
  PiErrorEvent,
  ThinkingLevel,
  PiRunnerConfig,
  PiExecutionResult,
} from './types'

// Event utilities
export {
  parseEvent,
  parseEvents,
  aggregateResult,
  extractText,
  isSuccess,
  getDoneReason,
} from './events'

// Process spawning
export {
  streamPi,
  runPi,
  runPiWithCallback,
  PiSpawnError,
  PiTimeoutError,
} from './spawn'
