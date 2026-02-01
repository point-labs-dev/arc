/**
 * Pi Event Parser
 * 
 * Parses JSON lines from Pi's --mode json output into typed events.
 */

import type { PiEvent, PiExecutionResult } from './types'

/**
 * Parse a single JSON line into a PiEvent
 */
export const parseEvent = (line: string): PiEvent | null => {
  const trimmed = line.trim()
  if (!trimmed) return null
  
  try {
    const event = JSON.parse(trimmed) as PiEvent
    // Validate it has a type field
    if (typeof event === 'object' && event !== null && 'type' in event) {
      return event
    }
    return null
  } catch {
    // Not valid JSON, skip
    return null
  }
}

/**
 * Parse multiple lines (newline-separated) into events
 */
export const parseEvents = (output: string): PiEvent[] => {
  const lines = output.split('\n')
  const events: PiEvent[] = []
  
  for (const line of lines) {
    const event = parseEvent(line)
    if (event) {
      events.push(event)
    }
  }
  
  return events
}

/**
 * Aggregate events into an execution result
 */
export const aggregateResult = (events: PiEvent[]): PiExecutionResult => {
  let output = ''
  const toolCalls: PiExecutionResult['toolCalls'] = []
  let currentToolCall: { name: string; arguments: Record<string, unknown> } | null = null
  let usage: PiExecutionResult['usage'] | undefined
  let error: string | undefined
  let success = true

  for (const event of events) {
    switch (event.type) {
      case 'text_delta':
        output += event.delta
        break
        
      case 'toolcall_end':
        currentToolCall = {
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        }
        break
        
      case 'tool_result':
        if (currentToolCall) {
          toolCalls.push({
            ...currentToolCall,
            result: event.output,
            isError: event.isError,
          })
          currentToolCall = null
        }
        break
        
      case 'done':
        if (event.usage) {
          usage = {
            input: event.usage.input,
            output: event.usage.output,
            cost: event.usage.cost.total,
          }
        }
        if (event.reason === 'error' || event.reason === 'aborted') {
          success = false
        }
        break
        
      case 'error':
        success = false
        error = event.message
        break
    }
  }

  return {
    success,
    events,
    output: output.trim(),
    toolCalls,
    usage,
    error,
  }
}

/**
 * Extract text output from events (for display)
 */
export const extractText = (events: PiEvent[]): string => {
  let text = ''
  for (const event of events) {
    if (event.type === 'text_delta') {
      text += event.delta
    }
  }
  return text
}

/**
 * Check if events indicate successful completion
 */
export const isSuccess = (events: PiEvent[]): boolean => {
  const doneEvent = events.find((e) => e.type === 'done')
  if (!doneEvent || doneEvent.type !== 'done') return false
  return doneEvent.reason === 'stop' || doneEvent.reason === 'toolUse'
}

/**
 * Get the final done reason
 */
export const getDoneReason = (events: PiEvent[]): string | null => {
  const doneEvent = events.find((e) => e.type === 'done')
  if (!doneEvent || doneEvent.type !== 'done') return null
  return doneEvent.reason
}
