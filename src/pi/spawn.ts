/**
 * Pi Process Spawner
 * 
 * Spawns Pi as a subprocess and streams JSON events.
 * Uses Pi's --mode json for structured output.
 */

import { spawn, type ChildProcess } from 'child_process'
import { Effect, Stream, Data } from 'effect'
import type { PiEvent, PiRunnerConfig, PiExecutionResult } from './types'
import { parseEvent, aggregateResult } from './events'

// === Errors ===

export class PiSpawnError extends Data.TaggedError('PiSpawnError')<{
  readonly message: string
  readonly code?: number
}> {}

export class PiTimeoutError extends Data.TaggedError('PiTimeoutError')<{
  readonly message: string
  readonly timeout: number
}> {}

// === Default Config ===

const DEFAULT_CONFIG: Required<Pick<PiRunnerConfig, 'thinking' | 'timeout' | 'tools'>> = {
  thinking: 'medium',
  timeout: 300000, // 5 minutes
  tools: ['read', 'write', 'edit', 'bash'],
}

// === Build CLI Args ===

const buildArgs = (prompt: string, config: PiRunnerConfig): string[] => {
  const args: string[] = [
    '--mode', 'json',
    '--no-session',
    '-p', prompt,
  ]

  // Thinking level
  const thinking = config.thinking ?? DEFAULT_CONFIG.thinking
  if (thinking !== 'off') {
    args.push('--thinking', thinking)
  }

  // Provider
  if (config.provider) {
    args.push('--provider', config.provider)
  }

  // Model
  if (config.model) {
    args.push('--model', config.model)
  }

  // Tools
  const tools = config.tools ?? DEFAULT_CONFIG.tools
  if (tools.length > 0) {
    args.push('--tools', tools.join(','))
  }

  return args
}

// === Stream Pi Events ===

/**
 * Run Pi and stream events as they arrive.
 * 
 * @param prompt - The prompt to send to Pi
 * @param config - Configuration options
 * @returns Stream of Pi events
 */
export const streamPi = (
  prompt: string,
  config: PiRunnerConfig = {}
): Stream.Stream<PiEvent, PiSpawnError | PiTimeoutError> =>
  Stream.async((emit) => {
    const args = buildArgs(prompt, config)
    const timeout = config.timeout ?? DEFAULT_CONFIG.timeout

    let pi: ChildProcess | null = null
    let timeoutId: NodeJS.Timeout | null = null
    let killed = false

    try {
      pi = spawn('pi', args, {
        cwd: config.cwd ?? process.cwd(),
        env: {
          ...process.env,
          ...config.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      emit.fail(new PiSpawnError({
        message: `Failed to spawn Pi: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }))
      return Effect.void
    }

    let buffer = ''

    pi.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const event = parseEvent(line)
        if (event) {
          emit.single(event)
        }
      }
    })

    pi.stderr?.on('data', (chunk: Buffer) => {
      // Log stderr for debugging but don't fail
      const text = chunk.toString().trim()
      if (text) {
        console.error('[Pi stderr]', text)
      }
    })

    pi.on('error', (err) => {
      if (!killed) {
        emit.fail(new PiSpawnError({
          message: `Pi process error: ${err.message}`,
        }))
      }
    })

    pi.on('close', (code) => {
      // Process remaining buffer
      if (buffer.trim()) {
        const event = parseEvent(buffer)
        if (event) {
          emit.single(event)
        }
      }

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (killed) {
        // Already handled by timeout
        return
      }

      if (code === 0) {
        emit.end()
      } else {
        emit.fail(new PiSpawnError({
          message: `Pi exited with code ${code}`,
          code: code ?? undefined,
        }))
      }
    })

    // Set timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true
        pi?.kill('SIGTERM')
        emit.fail(new PiTimeoutError({
          message: `Pi execution timed out after ${timeout}ms`,
          timeout,
        }))
      }, timeout)
    }

    // Cleanup function
    return Effect.sync(() => {
      killed = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      pi?.kill('SIGTERM')
    })
  })

// === Run Pi to Completion ===

/**
 * Run Pi and collect all events into a result.
 * 
 * @param prompt - The prompt to send to Pi
 * @param config - Configuration options
 * @returns Effect with the execution result
 */
export const runPi = (
  prompt: string,
  config: PiRunnerConfig = {}
): Effect.Effect<PiExecutionResult, PiSpawnError | PiTimeoutError> =>
  Effect.gen(function* () {
    const events: PiEvent[] = []

    yield* Stream.runForEach(
      streamPi(prompt, config),
      (event) => Effect.sync(() => events.push(event))
    )

    return aggregateResult(events)
  })

// === Run Pi with Event Callback ===

/**
 * Run Pi with a callback for each event (useful for UI updates).
 * 
 * @param prompt - The prompt to send to Pi
 * @param config - Configuration options
 * @param onEvent - Callback for each event
 * @returns Effect with the execution result
 */
export const runPiWithCallback = (
  prompt: string,
  config: PiRunnerConfig = {},
  onEvent: (event: PiEvent) => void
): Effect.Effect<PiExecutionResult, PiSpawnError | PiTimeoutError> =>
  Effect.gen(function* () {
    const events: PiEvent[] = []

    yield* Stream.runForEach(
      streamPi(prompt, config),
      (event) => Effect.sync(() => {
        events.push(event)
        onEvent(event)
      })
    )

    return aggregateResult(events)
  })
