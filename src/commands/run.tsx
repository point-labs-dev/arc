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
import * as path from "path"
import type { Plan, Step } from "../types/plan"
import { getCurrentStep, isComplete } from "../types/plan"
import {
  runAgent,
  AgentSpawnError,
  AgentTimeoutError,
  AgentNotFoundError,
  AGENTS,
  type AgentType,
  type AgentConfig,
  type AgentExecutionResult,
} from "../agents"
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
  agent: AgentType
  provider?: string
  model?: string
  autoApprove: boolean
}

type UIState = 
  | { type: "running"; message: string }
  | { type: "paused"; stepIteration: number }
  | { type: "review"; diff: string }
  | { type: "tune"; currentPrompt: string }
  | { type: "complete" }
  | { type: "error"; message: string }

// === Context File Loading ===

/**
 * Ensure both AGENTS.md and CLAUDE.md exist (symlinked).
 * If only one exists, create a symlink for the other.
 * This follows OpenClaw's convention.
 */
const ensureContextSymlinks = (cwd: string): void => {
  const agentsMdPath = path.join(cwd, "AGENTS.md")
  const claudeMdPath = path.join(cwd, "CLAUDE.md")
  
  const agentsExists = fs.existsSync(agentsMdPath)
  const claudeExists = fs.existsSync(claudeMdPath)
  
  if (agentsExists && !claudeExists) {
    // Create CLAUDE.md -> AGENTS.md symlink
    try {
      fs.symlinkSync("AGENTS.md", claudeMdPath)
    } catch {
      // Ignore symlink errors (permissions, etc.)
    }
  } else if (claudeExists && !agentsExists) {
    // Create AGENTS.md -> CLAUDE.md symlink
    try {
      fs.symlinkSync("CLAUDE.md", agentsMdPath)
    } catch {
      // Ignore symlink errors
    }
  }
}

/**
 * Load AGENTS.md or CLAUDE.md from the working directory.
 * Prefers AGENTS.md, falls back to CLAUDE.md.
 */
const loadAgentContext = (cwd: string): string | null => {
  // Ensure symlinks exist for both names
  ensureContextSymlinks(cwd)
  
  const agentsMdPath = path.join(cwd, "AGENTS.md")
  const claudeMdPath = path.join(cwd, "CLAUDE.md")
  
  if (fs.existsSync(agentsMdPath)) {
    try {
      return fs.readFileSync(agentsMdPath, "utf-8")
    } catch {
      return null
    }
  }
  
  if (fs.existsSync(claudeMdPath)) {
    try {
      return fs.readFileSync(claudeMdPath, "utf-8")
    } catch {
      return null
    }
  }
  
  return null
}

// === Prompt Builder ===

const buildStepPrompt = (step: Step, plan: Plan, cwd: string): string => {
  const parts: string[] = []

  // Load AGENTS.md or CLAUDE.md context
  const agentContext = loadAgentContext(cwd)
  if (agentContext) {
    parts.push(`# Project Context\n\n${agentContext}`)
    parts.push("---\n")
  }

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
  
  const cwd = process.cwd()
  const agentInfo = AGENTS[config.agent]
  
  // Build prompt with context from previous attempts
  const basePrompt = context.promptOverride || buildStepPrompt(step, context.plan, cwd)
  const prompt = buildContextualPrompt(basePrompt, context.previousAttempts)
  
  onOutput(`\n${"─".repeat(60)}\n`)
  onOutput(`📍 Step: ${step.description}\n`)
  onOutput(`🤖 Agent: ${agentInfo.name}\n`)
  onOutput(`🔄 Iteration ${context.stepIteration} (total: ${context.iteration})\n`)
  
  if (context.previousAttempts.length > 0) {
    const lastAttempt = context.previousAttempts[context.previousAttempts.length - 1]
    if (lastAttempt.error) {
      onOutput(`⚠️  Previous error: ${lastAttempt.error}\n`)
    }
  }
  
  onOutput(`${"─".repeat(60)}\n\n`)

  // Configure agent
  const agentConfig: AgentConfig = {
    agent: config.agent,
    cwd,
    autoApprove: config.autoApprove,
    timeout: 300000, // 5 minutes
    provider: config.provider,
    model: config.model,
  }

  // Run agent with streaming output
  let agentResult: AgentExecutionResult
  try {
    agentResult = await Effect.runPromise(
      runAgent(prompt, agentConfig, (text) => {
        onOutput(text)
      }).pipe(
        Effect.catchAll((error) => {
          if (error instanceof AgentNotFoundError) {
            onOutput(`\n❌ Agent not found: ${error.message}\n`)
            onOutput(`\nInstall ${agentInfo.name}: check --help for instructions\n`)
          } else if (error instanceof AgentSpawnError) {
            onOutput(`\n❌ Failed to spawn ${agentInfo.name}: ${error.message}\n`)
          } else if (error instanceof AgentTimeoutError) {
            onOutput(`\n⏱️ Timed out after ${error.timeout}ms\n`)
          }
          return Effect.succeed({
            success: false,
            output: "",
            exitCode: 1,
            error: error.message,
            durationMs: 0,
          } satisfies AgentExecutionResult)
        })
      )
    )
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error"
    onOutput(`\n❌ Error: ${errorMsg}\n`)
    return { 
      success: false, 
      output: "", 
      verificationPassed: false,
      error: errorMsg,
    }
  }

  onOutput(`\n✓ ${agentInfo.name} finished (exit ${agentResult.exitCode}, ${(agentResult.durationMs / 1000).toFixed(1)}s)\n`)

  if (!agentResult.success) {
    return {
      success: false,
      output: agentResult.output,
      verificationPassed: false,
      error: agentResult.error || `${agentInfo.name} execution failed`,
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
          output: agentResult.output, 
          verificationPassed: true,
        }
      } else {
        onOutput(`\n❌ Verification failed (exit ${exitCode})\n`)
        return { 
          success: true, // Agent succeeded, but verification failed
          output: agentResult.output, 
          verificationPassed: false,
          error: `Verification failed with exit code ${exitCode}`,
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Unknown"
      onOutput(`\n❌ Verification error: ${errorMsg}\n`)
      return { 
        success: true, 
        output: agentResult.output, 
        verificationPassed: false,
        error: `Verification error: ${errorMsg}`,
      }
    }
  }

  // No verification - assume success
  return { 
    success: true, 
    output: agentResult.output, 
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
            const prompt = buildStepPrompt(step, plan, process.cwd())
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
  const agentInfo = AGENTS[config.agent]
  const providerInfo = config.provider ? ` (${config.provider})` : ""

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="magenta">⚡ Arc</Text>
        <Text color="gray"> → </Text>
        <Text color="cyan">{agentInfo.name}{providerInfo}</Text>
        <Text color="gray"> │ </Text>
        <Text>{plan.name}</Text>
        <Text color="gray"> │ </Text>
        <Text color="green">[{completedSteps}/{totalSteps}]</Text>
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
    agent?: AgentType
    provider?: string
    model?: string
    autoApprove?: boolean
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

    const agent = options.agent ?? "claude-code"
    const agentInfo = AGENTS[agent]

    const config: RunConfig = {
      crankMode: options.crank ?? false,
      maxIterationsPerStep: options.maxIterations ?? 5,
      maxNoChangeIterations: options.maxNoChange ?? 3,
      maxTotalIterations: options.maxTotal ?? 50,
      agent,
      provider: options.provider,
      model: options.model,
      autoApprove: options.autoApprove ?? false,
    }

    // Check for context files
    const cwd = process.cwd()
    const hasAgentsMd = fs.existsSync(path.join(cwd, "AGENTS.md"))
    const hasClaudeMd = fs.existsSync(path.join(cwd, "CLAUDE.md"))
    const contextFile = hasAgentsMd ? "AGENTS.md" : hasClaudeMd ? "CLAUDE.md" : null

    console.log(`\n⚡ Arc - Agent-Agnostic Execution`)
    console.log(`📋 Plan: ${plan.name}`)
    console.log(`🤖 Agent: ${agentInfo.name}${config.provider ? ` (${config.provider})` : ""}`)
    console.log(`📊 ${plan.steps.length} steps`)
    if (contextFile) {
      console.log(`📄 Context: ${contextFile}`)
    }
    console.log(`🔧 Mode: ${config.crankMode ? "Hand-crank" : "Continuous"}${config.autoApprove ? " [auto-approve]" : ""}`)
    console.log(`🔄 Max ${config.maxIterationsPerStep} iterations/step, ${config.maxNoChangeIterations} no-change limit\n`)

    const onComplete = (finalPlan: Plan) => {
      fs.writeFileSync(planFile, JSON.stringify(finalPlan, null, 2))
      console.log(`\n💾 Plan saved to ${planFile}`)
      resume(Effect.succeed(undefined))
    }

    render(React.createElement(RunApp, { plan, config, onComplete }))
  })
