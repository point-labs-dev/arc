/**
 * Run Command - Phase 2
 * 
 * Executes a plan using the Ralph loop with Pi as the execution engine.
 * 
 * Modes:
 * - Continuous: Ralph loops until complete or circuit breaker trips
 * - Hand-crank: Pauses after each iteration for [C]ontinue/[R]eview/[T]une/[S]kip/[Q]uit
 */

import { Effect } from "effect"
import { render, Box, Text, useInput, useApp, Newline } from "ink"
import Spinner from "ink-spinner"
import TextInput from "ink-text-input"
import React, { useState, useEffect, useCallback, useRef } from "react"
import * as fs from "fs"
import type { Plan, Step } from "../types/plan"
import { getCurrentStep, isComplete } from "../types/plan"
import { 
  runPiWithCallback, 
  PiSpawnError, 
  PiTimeoutError,
  type PiEvent,
  type PiRunnerConfig,
  type PiExecutionResult,
} from "../pi"
import {
  runRalphLoop,
  buildContextualPrompt,
  type RalphConfig,
  type RalphEvent,
  type ExecutionContext,
  type ExecutionResult,
  type CrankAction,
} from "../core/ralph"
import { getDiffText, formatChangeSummary } from "../core/diff"

// === Types ===

interface RunConfig {
  crankMode: boolean
  maxIterationsPerStep: number
  maxNoChangeIterations: number
  maxTotalIterations: number
  provider?: string
  model?: string
}

type UIState = 
  | { type: "running"; message: string }
  | { type: "paused"; stepIteration: number }
  | { type: "review"; diff: string }
  | { type: "tune"; currentPrompt: string }
  | { type: "complete" }
  | { type: "error"; message: string }

// === Prompt Builder ===

const buildStepPrompt = (step: Step, plan: Plan): string => {
  const parts: string[] = []

  // Main task
  parts.push(`# Task
${step.description}`)

  // Details if present
  if (step.details) {
    parts.push(`## Details
${step.details}`)
  }

  // Context files
  if (plan.context.files?.length) {
    parts.push(`## Reference Files
${plan.context.files.map(f => `- ${f}`).join('\n')}`)
  }

  // Tech stack
  if (plan.context.techStack?.length) {
    parts.push(`## Tech Stack
${plan.context.techStack.join(', ')}`)
  }

  // Constraints
  if (plan.context.constraints?.length) {
    parts.push(`## Constraints
${plan.context.constraints.map(c => `- ${c}`).join('\n')}`)
  }

  // Notes
  if (plan.context.notes) {
    parts.push(`## Notes
${plan.context.notes}`)
  }

  // Verification
  if (step.verification?.command) {
    parts.push(`## Verification
When complete, this command should pass:
\`\`\`bash
${step.verification.command}
\`\`\``)
  }

  // Instructions
  parts.push(`## Instructions
Work until the task is complete. Use the available tools (read, write, edit, bash) to accomplish it.
If verification is specified, make sure it passes before considering the task done.`)

  return parts.join('\n\n')
}

// === Executor ===

const createExecutor = (
  config: RunConfig,
  onOutput: (text: string) => void
) => async (step: Step, context: ExecutionContext): Promise<ExecutionResult> => {
  
  // Build prompt with context from previous attempts
  const basePrompt = context.promptOverride || buildStepPrompt(step, context.plan)
  const prompt = buildContextualPrompt(basePrompt, context.previousAttempts)

  onOutput(`\n${"─".repeat(60)}\n`)
  onOutput(`📍 Step: ${step.description}\n`)
  onOutput(`🔄 Iteration ${context.stepIteration} (total: ${context.iteration})\n`)
  
  if (context.previousAttempts.length > 0) {
    const lastAttempt = context.previousAttempts[context.previousAttempts.length - 1]
    if (lastAttempt.error) {
      onOutput(`⚠️  Previous error: ${lastAttempt.error}\n`)
    }
  }
  
  onOutput(`${"─".repeat(60)}\n\n`)

  let fullOutput = ""

  // Configure Pi
  const piConfig: PiRunnerConfig = {
    thinking: "medium",
    timeout: 300000, // 5 minutes
    provider: config.provider,
    model: config.model,
  }

  // Handle Pi events
  const handleEvent = (event: PiEvent) => {
    switch (event.type) {
      case "text_delta":
        fullOutput += event.delta
        onOutput(event.delta)
        break
      case "toolcall_start":
        onOutput(`\n🔧 ${event.name}\n`)
        break
      case "tool_result":
        if (event.isError) {
          onOutput(`⚠️ ${event.output.slice(0, 200)}\n`)
        }
        break
      case "error":
        onOutput(`\n❌ ${event.message}\n`)
        break
      case "done":
        onOutput(`\n✓ Done (${event.reason})\n`)
        break
    }
  }

  // Run Pi
  let piResult: PiExecutionResult
  try {
    piResult = await Effect.runPromise(
      runPiWithCallback(prompt, piConfig, handleEvent).pipe(
        Effect.catchAll((error) => {
          if (error instanceof PiSpawnError) {
            onOutput(`\n❌ Failed to spawn Pi: ${error.message}\n`)
            onOutput(`\nMake sure Pi is installed: npm install -g @mariozechner/pi-coding-agent\n`)
          } else if (error instanceof PiTimeoutError) {
            onOutput(`\n⏱️ Timed out after ${error.timeout}ms\n`)
          }
          return Effect.succeed({
            success: false,
            events: [],
            output: "",
            toolCalls: [],
            error: error.message,
          } satisfies PiExecutionResult)
        })
      )
    )
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error"
    onOutput(`\n❌ Error: ${errorMsg}\n`)
    return { 
      success: false, 
      output: fullOutput, 
      verificationPassed: false,
      error: errorMsg,
    }
  }

  if (!piResult.success) {
    return {
      success: false,
      output: fullOutput,
      verificationPassed: false,
      error: piResult.error || "Pi execution failed",
    }
  }

  // Run verification if present
  if (step.verification?.command) {
    onOutput(`\n\n🔍 Verifying: ${step.verification.command}\n`)
    
    try {
      const proc = Bun.spawn(["sh", "-c", step.verification.command], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: process.cwd(),
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (stdout.trim()) onOutput(stdout)
      if (stderr.trim()) onOutput(`⚠️ ${stderr}`)

      if (exitCode === 0) {
        onOutput(`\n✅ Verification passed!\n`)
        return { 
          success: true, 
          output: fullOutput, 
          verificationPassed: true,
        }
      } else {
        onOutput(`\n❌ Verification failed (exit ${exitCode})\n`)
        return { 
          success: true, // Pi succeeded, but verification failed
          output: fullOutput, 
          verificationPassed: false,
          error: `Verification failed with exit code ${exitCode}`,
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Unknown"
      onOutput(`\n❌ Verification error: ${errorMsg}\n`)
      return { 
        success: true, 
        output: fullOutput, 
        verificationPassed: false,
        error: `Verification error: ${errorMsg}`,
      }
    }
  }

  // No verification - assume success
  return { 
    success: true, 
    output: fullOutput, 
    verificationPassed: true,
  }
}

// === Components ===

interface RunAppProps {
  plan: Plan
  config: RunConfig
  onComplete: (plan: Plan) => void
}

const RunApp: React.FC<RunAppProps> = ({ plan: initialPlan, config, onComplete }) => {
  const { exit } = useApp()
  const [plan, setPlan] = useState(initialPlan)
  const [uiState, setUIState] = useState<UIState>({ type: "running", message: "Starting..." })
  const [output, setOutput] = useState<string[]>([])
  const [stats, setStats] = useState({ iteration: 0, stepIteration: 0 })
  const [tuneText, setTuneText] = useState("")
  
  const outputRef = useRef<string[]>([])
  const crankResolverRef = useRef<((action: CrankAction) => void) | null>(null)
  const currentStepRef = useRef<Step | null>(null)

  const addOutput = useCallback((text: string) => {
    // Split by newlines and add each line
    const lines = text.split('\n')
    outputRef.current = [...outputRef.current.slice(-200), ...lines]
    setOutput([...outputRef.current])
  }, [])

  const handleRalphEvent = useCallback((event: RalphEvent) => {
    switch (event.type) {
      case "step_start":
        currentStepRef.current = event.step
        setStats({ iteration: event.totalIteration, stepIteration: event.stepIteration })
        setUIState({ type: "running", message: `Iteration ${event.stepIteration}...` })
        break
      case "step_iteration_end":
        const summary = formatChangeSummary(event.changes.changes)
        addOutput(`\n📊 Changes: ${summary}\n`)
        break
      case "step_complete":
        addOutput(`\n🎉 Step completed in ${event.iterations} iteration(s)!\n`)
        break
      case "step_failed":
        addOutput(`\n💥 Step failed: ${event.reason}\n`)
        break
      case "circuit_breaker":
        addOutput(`\n🔌 Circuit breaker: No changes for ${event.noChangeCount} iterations\n`)
        break
      case "crank_pause":
        setUIState({ type: "paused", stepIteration: event.stepIteration })
        break
      case "loop_complete":
        setUIState({ type: "complete" })
        break
    }
  }, [addOutput])

  const handleCrank = useCallback((): Promise<CrankAction> => {
    return new Promise((resolve) => {
      crankResolverRef.current = resolve
    })
  }, [])

  // Start the Ralph loop
  useEffect(() => {
    const cwd = process.cwd()
    
    const ralphConfig: RalphConfig = {
      cwd,
      maxIterationsPerStep: config.maxIterationsPerStep,
      maxNoChangeIterations: config.maxNoChangeIterations,
      maxTotalIterations: config.maxTotalIterations,
      crankMode: config.crankMode,
      executor: createExecutor(config, addOutput),
      onEvent: handleRalphEvent,
      onCrank: config.crankMode ? handleCrank : undefined,
    }

    Effect.runPromise(
      runRalphLoop(initialPlan, ralphConfig).pipe(
        Effect.tap((finalPlan) => Effect.sync(() => {
          setPlan(finalPlan)
          onComplete(finalPlan)
        })),
        Effect.catchAll((error) => Effect.sync(() => {
          if (error._tag === "UserStopped") {
            addOutput("\n👋 Stopped by user\n")
          } else if (error._tag === "CircuitBreakerTripped") {
            addOutput(`\n🔌 Circuit breaker tripped: ${error.message}\n`)
          } else if (error._tag === "MaxIterationsReached") {
            addOutput(`\n⏱️ Max iterations reached: ${error.message}\n`)
          } else {
            addOutput(`\n❌ Error: ${error.message}\n`)
          }
          setUIState({ type: "error", message: error.message })
        }))
      )
    )
  }, []) // Only run once

  // Handle keyboard input
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      fs.writeFileSync("plan-progress.json", JSON.stringify(plan, null, 2))
      console.log("\n💾 Progress saved to plan-progress.json")
      if (crankResolverRef.current) {
        crankResolverRef.current({ type: "stop" })
      }
      exit()
    }

    if (uiState.type === "paused") {
      switch (inputChar.toLowerCase()) {
        case "c":
          setUIState({ type: "running", message: "Continuing..." })
          crankResolverRef.current?.({ type: "continue" })
          break
        case "r":
          // Show diff
          Effect.runPromise(
            getDiffText(process.cwd(), "HEAD~1").pipe(
              Effect.catchAll(() => Effect.succeed("(Unable to get diff)"))
            )
          ).then((diff) => {
            setUIState({ type: "review", diff })
          })
          break
        case "t":
          const step = currentStepRef.current
          if (step) {
            const prompt = buildStepPrompt(step, plan)
            setTuneText(prompt)
            setUIState({ type: "tune", currentPrompt: prompt })
          }
          break
        case "s":
          addOutput("\n⏭️ Skipping step...\n")
          crankResolverRef.current?.({ type: "skip" })
          break
        case "q":
          crankResolverRef.current?.({ type: "stop" })
          break
      }
    }

    if (uiState.type === "review") {
      if (inputChar.toLowerCase() === "b" || key.escape) {
        setUIState({ type: "paused", stepIteration: stats.stepIteration })
      }
    }

    if (uiState.type === "tune") {
      if (key.escape) {
        setUIState({ type: "paused", stepIteration: stats.stepIteration })
      }
      if (key.return && key.ctrl) {
        crankResolverRef.current?.({ type: "tune", newPrompt: tuneText })
        setUIState({ type: "running", message: "Running with tuned prompt..." })
      }
    }
  })

  const currentStep = getCurrentStep(plan)
  const completedSteps = plan.steps.filter((s) => s.status === "completed").length
  const totalSteps = plan.steps.length
  const providerInfo = config.provider ? ` → ${config.provider}` : ""

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="magenta">⚡ Arc</Text>
        <Text color="gray">{providerInfo} │ </Text>
        <Text>{plan.name}</Text>
        <Text color="gray"> │ </Text>
        <Text color="cyan">[{completedSteps}/{totalSteps}]</Text>
        <Text color="gray"> │ iter: {stats.iteration}</Text>
      </Box>

      {/* Progress Bar */}
      <Box marginBottom={1}>
        <Text color="green">{"█".repeat(completedSteps)}</Text>
        <Text color="yellow">{currentStep ? "▓" : ""}</Text>
        <Text color="gray">{"░".repeat(Math.max(0, totalSteps - completedSteps - 1))}</Text>
      </Box>

      {/* Current Step */}
      {currentStep && (
        <Box marginBottom={1}>
          <Text color="yellow">→ </Text>
          <Text>{currentStep.description}</Text>
          {stats.stepIteration > 1 && (
            <Text color="gray"> (attempt {stats.stepIteration})</Text>
          )}
        </Box>
      )}

      {/* Status */}
      <Box marginBottom={1}>
        {uiState.type === "running" && (
          <>
            <Spinner type="dots" />
            <Text color="yellow"> {uiState.message}</Text>
          </>
        )}
        {uiState.type === "paused" && (
          <Box flexDirection="column">
            <Text color="cyan">⏸️  Paused after iteration {uiState.stepIteration}</Text>
            <Box marginTop={1}>
              <Text color="gray">[</Text>
              <Text color="green">C</Text>
              <Text color="gray">]ontinue  [</Text>
              <Text color="blue">R</Text>
              <Text color="gray">]eview  [</Text>
              <Text color="yellow">T</Text>
              <Text color="gray">]une  [</Text>
              <Text color="magenta">S</Text>
              <Text color="gray">]kip  [</Text>
              <Text color="red">Q</Text>
              <Text color="gray">]uit</Text>
            </Box>
          </Box>
        )}
        {uiState.type === "review" && (
          <Box flexDirection="column">
            <Text color="blue">📝 Review - Changes since last iteration:</Text>
            <Box 
              marginTop={1} 
              borderStyle="single" 
              borderColor="gray" 
              padding={1}
              height={10}
            >
              <Text>{uiState.diff.slice(0, 2000) || "(no changes)"}</Text>
            </Box>
            <Text color="gray">Press [B] or Esc to go back</Text>
          </Box>
        )}
        {uiState.type === "tune" && (
          <Box flexDirection="column">
            <Text color="yellow">🎸 Tune - Edit the prompt:</Text>
            <Box marginTop={1} borderStyle="single" borderColor="yellow" padding={1}>
              <TextInput 
                value={tuneText} 
                onChange={setTuneText}
                placeholder="Edit prompt..."
              />
            </Box>
            <Text color="gray">Ctrl+Enter to submit, Esc to cancel</Text>
          </Box>
        )}
        {uiState.type === "complete" && (
          <Text color="green">✅ Plan complete!</Text>
        )}
        {uiState.type === "error" && (
          <Text color="red">❌ {uiState.message}</Text>
        )}
      </Box>

      {/* Output Log */}
      {uiState.type !== "review" && uiState.type !== "tune" && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
          height={12}
          overflowY="hidden"
        >
          {output.slice(-10).map((line, i) => (
            <Text key={i} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          {config.crankMode ? "🔧 Hand-crank" : "🔄 Continuous"} │ Ctrl+C to save & exit
        </Text>
      </Box>
    </Box>
  )
}

// === Command Entry Point ===

export const runRunCommand = (
  planFile: string,
  options: {
    crank?: boolean
    maxIterations?: number
    maxNoChange?: number
    maxTotal?: number
    provider?: string
    model?: string
  } = {}
): Effect.Effect<void, Error> =>
  Effect.async((resume) => {
    // Load plan
    if (!fs.existsSync(planFile)) {
      console.error(`Error: Plan file not found: ${planFile}`)
      resume(Effect.fail(new Error("Plan file not found")))
      return
    }

    let plan: Plan
    try {
      const content = fs.readFileSync(planFile, "utf-8")
      plan = JSON.parse(content) as Plan
    } catch (e) {
      console.error(`Error: Invalid plan file: ${e}`)
      resume(Effect.fail(new Error("Invalid plan file")))
      return
    }

    const config: RunConfig = {
      crankMode: options.crank ?? false,
      maxIterationsPerStep: options.maxIterations ?? 5,
      maxNoChangeIterations: options.maxNoChange ?? 3,
      maxTotalIterations: options.maxTotal ?? 50,
      provider: options.provider,
      model: options.model,
    }

    console.log(`\n⚡ Arc - Ralph Loop (Phase 2)`)
    console.log(`📋 Plan: ${plan.name}`)
    console.log(`📊 ${plan.steps.length} steps`)
    console.log(`🔧 Mode: ${config.crankMode ? "Hand-crank" : "Continuous"}`)
    console.log(`🔄 Max ${config.maxIterationsPerStep} iterations/step, ${config.maxNoChangeIterations} no-change limit\n`)

    const onComplete = (finalPlan: Plan) => {
      fs.writeFileSync(planFile, JSON.stringify(finalPlan, null, 2))
      console.log(`\n💾 Plan saved to ${planFile}`)
      resume(Effect.succeed(undefined))
    }

    render(React.createElement(RunApp, { plan, config, onComplete }))
  })
