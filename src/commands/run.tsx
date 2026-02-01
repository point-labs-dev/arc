/**
 * Run Command
 * 
 * Executes a plan using the Arc loop with Pi as the execution engine.
 * Two modes:
 * - Continuous (arc mode): runs until complete
 * - Hand-crank: pauses after each iteration for review
 */

import { Effect } from "effect"
import { render, Box, Text, useInput, useApp } from "ink"
import Spinner from "ink-spinner"
import React, { useState, useEffect, useCallback, useRef } from "react"
import * as fs from "fs"
import type { Plan, Step } from "../types/plan"
import { getCurrentStep, updateStep, isComplete } from "../types/plan"
import { 
  runPiWithCallback, 
  PiSpawnError, 
  PiTimeoutError,
  type PiEvent,
  type PiRunnerConfig,
  type PiExecutionResult,
} from "../pi"

// === Types ===

interface RunConfig {
  crankMode: boolean
  maxIterations: number
  provider?: string
  model?: string
}

interface IterationState {
  iteration: number
  currentStep: Step | null
  status: "idle" | "running" | "paused" | "complete" | "error"
  output: string[]
  error?: string
}

// === Prompt Builder ===

const buildStepPrompt = (step: Step, plan: Plan): string => {
  const parts: string[] = []

  // Main task
  parts.push(`Execute this task:
${step.description}`)

  // Details if present
  if (step.details) {
    parts.push(`Details:
${step.details}`)
  }

  // Context files
  if (plan.context.files?.length) {
    parts.push(`Reference files:
${plan.context.files.join('\n')}`)
  }

  // Notes
  if (plan.context.notes) {
    parts.push(`Notes:
${plan.context.notes}`)
  }

  // Tech stack
  if (plan.context.techStack?.length) {
    parts.push(`Tech stack:
${plan.context.techStack.join(', ')}`)
  }

  // Constraints
  if (plan.context.constraints?.length) {
    parts.push(`Constraints:
${plan.context.constraints.map(c => `- ${c}`).join('\n')}`)
  }

  // Verification
  if (step.verification?.command) {
    parts.push(`When complete, this command should pass:
${step.verification.command}`)
  }

  // Instructions
  parts.push(`Work until the task is complete. Use the available tools (read, write, edit, bash) to accomplish it.`)

  return parts.join('\n\n')
}

// === Executor ===

const executeStep = async (
  step: Step,
  plan: Plan,
  config: RunConfig,
  onOutput: (text: string) => void
): Promise<{ success: boolean; output: string }> => {

  onOutput(`\n📍 Executing: ${step.description}\n`)
  onOutput(`🤖 Using Pi coding agent...\n\n`)

  const prompt = buildStepPrompt(step, plan)
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
        onOutput(`\n🔧 Tool: ${event.name}\n`)
        break
      case "tool_result":
        if (event.isError) {
          onOutput(`\n⚠️ Tool error: ${event.output.slice(0, 200)}\n`)
        } else {
          // Show truncated output for tool results
          const preview = event.output.slice(0, 500)
          if (event.output.length > 500) {
            onOutput(`${preview}...\n`)
          }
        }
        break
      case "thinking_delta":
        // Optionally show thinking (dimmed)
        // onOutput(event.delta)
        break
      case "error":
        onOutput(`\n❌ Pi error: ${event.message}\n`)
        break
      case "done":
        onOutput(`\n✓ Pi completed (${event.reason})\n`)
        break
    }
  }

  // Run Pi
  let result: PiExecutionResult
  try {
    result = await Effect.runPromise(
      runPiWithCallback(prompt, piConfig, handleEvent).pipe(
        Effect.catchAll((error) => {
          if (error instanceof PiSpawnError) {
            onOutput(`\n❌ Failed to spawn Pi: ${error.message}\n`)
            onOutput(`\nMake sure Pi is installed: npm install -g @mariozechner/pi-coding-agent\n`)
            onOutput(`Then login: pi → /login\n`)
          } else if (error instanceof PiTimeoutError) {
            onOutput(`\n⏱️ Pi execution timed out after ${error.timeout}ms\n`)
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
    onOutput(`\n❌ Unexpected error: ${e instanceof Error ? e.message : "Unknown"}\n`)
    return { success: false, output: fullOutput }
  }

  // Check if Pi succeeded
  if (!result.success) {
    onOutput(`\n❌ Pi execution failed: ${result.error || "Unknown error"}\n`)
    return { success: false, output: fullOutput }
  }

  // Run verification if present
  if (step.verification?.command) {
    onOutput(`\n\n🔍 Verifying: ${step.verification.command}\n`)
    
    try {
      const proc = Bun.spawn(["sh", "-c", step.verification.command], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (stdout) onOutput(stdout)
      if (stderr) onOutput(`\n⚠️ ${stderr}`)

      if (exitCode === 0) {
        onOutput(`\n✅ Verification passed\n`)
        return { success: true, output: fullOutput }
      } else {
        onOutput(`\n❌ Verification failed (exit code ${exitCode})\n`)
        return { success: false, output: fullOutput }
      }
    } catch (e) {
      onOutput(`\n❌ Verification error: ${e instanceof Error ? e.message : "Unknown"}\n`)
      return { success: false, output: fullOutput }
    }
  }

  // No verification specified - assume success if Pi completed
  return { success: true, output: fullOutput }
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
  const [state, setState] = useState<IterationState>({
    iteration: 0,
    currentStep: getCurrentStep(initialPlan) || null,
    status: "idle",
    output: [],
  })
  const outputRef = useRef<string[]>([])
  const isRunning = useRef(false)

  const addOutput = useCallback((text: string) => {
    outputRef.current = [...outputRef.current.slice(-100), text]
    setState((s) => ({ ...s, output: outputRef.current }))
  }, [])

  const runIteration = useCallback(async () => {
    if (isRunning.current) return
    isRunning.current = true

    const step = getCurrentStep(plan)
    if (!step) {
      setState((s) => ({ ...s, status: "complete" }))
      onComplete(plan)
      return
    }

    setState((s) => ({
      ...s,
      iteration: s.iteration + 1,
      currentStep: step,
      status: "running",
    }))

    try {
      const result = await executeStep(step, plan, config, addOutput)

      const newPlan = updateStep(plan, step.id, {
        status: result.success ? "completed" : "failed",
        completedAt: result.success ? new Date().toISOString() : undefined,
        lastError: result.success ? undefined : "Verification failed",
      })

      setPlan(newPlan)

      if (isComplete(newPlan)) {
        setState((s) => ({ ...s, status: "complete" }))
        onComplete(newPlan)
      } else if (config.crankMode) {
        setState((s) => ({ ...s, status: "paused" }))
      } else {
        // Continue to next iteration
        isRunning.current = false
        setTimeout(() => runIteration(), 100)
        return
      }
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      }))
    }

    isRunning.current = false
  }, [plan, config, addOutput, onComplete])

  // Start running on mount (or after pause)
  useEffect(() => {
    if (state.status === "idle") {
      runIteration()
    }
  }, [state.status, runIteration])

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      // Save progress
      fs.writeFileSync("plan-progress.json", JSON.stringify(plan, null, 2))
      console.log("\n💾 Progress saved to plan-progress.json")
      exit()
    }

    if (state.status === "paused") {
      switch (inputChar.toLowerCase()) {
        case "c": // Continue
          setState((s) => ({ ...s, status: "idle" }))
          break
        case "r": // Review (show diff - TODO)
          addOutput("\n📝 Review mode not yet implemented\n")
          break
        case "t": // Tune (edit prompt - TODO)
          addOutput("\n🎸 Tune mode not yet implemented\n")
          break
        case "s": // Stop
          onComplete(plan)
          exit()
          break
      }
    }
  })

  const completedSteps = plan.steps.filter((s) => s.status === "completed").length
  const totalSteps = plan.steps.length
  const providerInfo = config.provider ? ` (${config.provider})` : ""

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold color="magenta">⚡ Arc</Text>
          <Text color="gray"> → Pi{providerInfo} - {plan.name}</Text>
        </Box>
        <Box>
          <Text color="cyan">
            [{completedSteps}/{totalSteps}]
          </Text>
          <Text color="gray"> Iteration: {state.iteration}</Text>
        </Box>
      </Box>

      {/* Progress Bar */}
      <Box marginBottom={1}>
        <Text color="green">{"█".repeat(completedSteps)}</Text>
        <Text color="gray">{"░".repeat(totalSteps - completedSteps)}</Text>
      </Box>

      {/* Current Step */}
      {state.currentStep && (
        <Box marginBottom={1}>
          <Text color="yellow">📍 </Text>
          <Text>{state.currentStep.description}</Text>
        </Box>
      )}

      {/* Status Indicator */}
      <Box marginBottom={1}>
        {state.status === "running" && (
          <>
            <Spinner type="dots" />
            <Text color="yellow"> Executing via Pi...</Text>
          </>
        )}
        {state.status === "paused" && (
          <Text color="cyan">
            ⏸️ Paused - [C]ontinue, [R]eview, [T]une, [S]top
          </Text>
        )}
        {state.status === "complete" && (
          <Text color="green">✅ Plan complete!</Text>
        )}
        {state.status === "error" && (
          <Text color="red">❌ Error: {state.error}</Text>
        )}
      </Box>

      {/* Output */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        height={15}
        overflowY="hidden"
      >
        {state.output.slice(-10).map((line, i) => (
          <Text key={i} wrap="truncate">
            {line}
          </Text>
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          {config.crankMode ? "Hand-crank mode" : "Continuous mode"} • Ctrl+C to save & exit
        </Text>
      </Box>
    </Box>
  )
}

// === Command ===

export const runRunCommand = (
  planFile: string,
  config: RunConfig
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

    const providerInfo = config.provider ? ` via ${config.provider}` : ""
    console.log(`\n⚡ Arc → Pi${providerInfo}`)
    console.log(`📋 Executing: ${plan.name}`)
    console.log(`📊 ${plan.steps.length} steps, ${config.crankMode ? "hand-crank" : "continuous"} mode\n`)

    const onComplete = (finalPlan: Plan) => {
      // Save final plan
      fs.writeFileSync(planFile, JSON.stringify(finalPlan, null, 2))
      console.log(`\n✅ Execution complete! Plan saved to ${planFile}`)
      resume(Effect.succeed(undefined))
    }

    render(React.createElement(RunApp, { plan, config, onComplete }))
  })
