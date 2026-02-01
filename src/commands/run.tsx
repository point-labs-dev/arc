/**
 * Run Command
 * 
 * Executes a plan using the Arc loop.
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
import { createEventEmitter, type ArcEvent } from "../types/events"

// === Types ===

interface RunConfig {
  crankMode: boolean
  maxIterations: number
}

interface IterationState {
  iteration: number
  currentStep: Step | null
  status: "idle" | "running" | "paused" | "complete" | "error"
  output: string[]
  error?: string
}

// === Executor ===

const EXECUTOR_SYSTEM_PROMPT = `You are an expert coding agent executing a plan step by step.

Current step to implement:
{STEP_DESCRIPTION}

{STEP_DETAILS}

Instructions:
1. Implement this step completely
2. Write clean, well-documented code
3. Run the verification command when done
4. If verification fails, fix the issues

Available tools:
- Read files
- Write files
- Run shell commands

Start by understanding what needs to be done, then implement it.`

const executeStep = async (
  step: Step,
  plan: Plan,
  onOutput: (text: string) => void
): Promise<{ success: boolean; output: string }> => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required")
  }

  onOutput(`\n📍 Executing: ${step.description}\n`)

  const systemPrompt = EXECUTOR_SYSTEM_PROMPT
    .replace("{STEP_DESCRIPTION}", step.description)
    .replace("{STEP_DETAILS}", step.details || "")

  // Stream the response
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ARC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Execute the step described above. The plan context:\n${JSON.stringify(plan.context, null, 2)}`,
        },
      ],
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  // Parse SSE stream
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let fullOutput = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const data = line.slice(6)
      if (data === "[DONE]") continue

      try {
        const event = JSON.parse(data)
        if (event.type === "content_block_delta" && event.delta?.text) {
          const text = event.delta.text
          fullOutput += text
          onOutput(text)
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Run verification if present
  if (step.verification?.command) {
    onOutput(`\n\n🔍 Verifying: ${step.verification.command}\n`)
    
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
  }

  // Manual verification or no verification
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
      const result = await executeStep(step, plan, addOutput)

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
  }, [plan, config.crankMode, addOutput, onComplete])

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

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold color="magenta">⚡ Arc</Text>
          <Text color="gray"> - {plan.name}</Text>
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
            <Text color="yellow"> Executing...</Text>
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

    console.log(`\n⚡ Arc - Executing: ${plan.name}`)
    console.log(`📋 ${plan.steps.length} steps, ${config.crankMode ? "hand-crank" : "continuous"} mode\n`)

    const onComplete = (finalPlan: Plan) => {
      // Save final plan
      fs.writeFileSync(planFile, JSON.stringify(finalPlan, null, 2))
      console.log(`\n✅ Execution complete! Plan saved to ${planFile}`)
      resume(Effect.succeed(undefined))
    }

    render(React.createElement(RunApp, { plan, config, onComplete }))
  })
