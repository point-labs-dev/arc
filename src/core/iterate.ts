/**
 * Iterate - The Core Loop
 * 
 * Rapid iteration flow:
 * 1. Pick or generate next task
 * 2. Build it (Ralph loop until verified)
 * 3. Record outcome + learnings
 * 4. Update plan based on what we learned
 * 5. Check if goal is met
 */

import { Effect } from "effect"
import { Data } from "effect"
import type {
  Project,
  Task,
  CompletedTask,
  Insight,
  Iteration,
} from "../types/project"
import {
  createTask,
  createInsight,
  getNextTask,
} from "../types/project"
import { runAgent, type AgentConfig, type AgentExecutionResult } from "../agents"
import { createSnapshot, type DiffSnapshot } from "./diff"

// === Errors ===

export class NoTasksError extends Data.TaggedError("NoTasksError")<{
  readonly message: string
}> {}

export class BuildError extends Data.TaggedError("BuildError")<{
  readonly message: string
  readonly taskId: string
  readonly attempts: number
}> {}

export class VerificationError extends Data.TaggedError("VerificationError")<{
  readonly message: string
  readonly taskId: string
}> {}

// === Types ===

export interface IterateConfig {
  /** Working directory */
  cwd: string
  /** Agent to use for building */
  agent: AgentConfig
  /** Max attempts per task before giving up */
  maxAttempts: number
  /** Callback for output streaming */
  onOutput?: (text: string) => void
  /** Callback for status updates */
  onStatus?: (status: IterateStatus) => void
  /** Whether to auto-generate tasks if backlog is empty */
  autoGenerateTasks?: boolean
}

export type IterateStatus =
  | { type: "picking_task" }
  | { type: "building"; task: Task; attempt: number }
  | { type: "verifying"; task: Task }
  | { type: "recording"; task: Task; success: boolean }
  | { type: "updating_plan" }
  | { type: "complete"; task: Task; iterations: number }
  | { type: "failed"; task: Task; reason: string }

export interface IterateResult {
  /** The task that was worked on */
  task: Task
  /** Whether the task was completed successfully */
  success: boolean
  /** Number of attempts it took */
  iterations: number
  /** What changed */
  filesChanged: string[]
  /** Summary of what was done */
  outcome: string
  /** New insights discovered */
  insights: Insight[]
  /** Updated project state */
  project: Project
}

// === Build Prompt ===

const buildTaskPrompt = (task: Task, project: Project, attempt: number, previousError?: string): string => {
  const parts: string[] = []
  
  // Goal context
  parts.push(`# Project Goal\n${project.goal}`)
  
  if (project.context) {
    parts.push(`\n## Project Context\n${project.context}`)
  }
  
  // Recent insights
  if (project.insights.length > 0) {
    const recentInsights = project.insights.slice(-5)
    parts.push(`\n## Recent Learnings`)
    for (const insight of recentInsights) {
      parts.push(`- ${insight.content}`)
    }
  }
  
  // The task
  parts.push(`\n# Current Task\n${task.description}`)
  
  if (task.why) {
    parts.push(`\n## Why This Matters\n${task.why}`)
  }
  
  if (task.acceptanceCriteria) {
    parts.push(`\n## Acceptance Criteria\n${task.acceptanceCriteria}`)
  }
  
  // Previous attempt context
  if (attempt > 1 && previousError) {
    parts.push(`\n## Previous Attempt Failed`)
    parts.push(`Attempt ${attempt - 1} failed with: ${previousError}`)
    parts.push(`Try a different approach.`)
  }
  
  // Instructions
  parts.push(`\n## Instructions`)
  parts.push(`Complete this task. Use the available tools to read, write, and edit files.`)
  parts.push(`Work until the task is done or you're blocked and need help.`)
  
  return parts.join("\n")
}

// === Core Iterate Function ===

/**
 * Run one iteration of the development loop.
 * 
 * 1. Pick next task from backlog
 * 2. Build it with Ralph loop (iterate until success or max attempts)
 * 3. Record what happened
 * 4. Extract learnings
 * 5. Return updated project
 */
export const iterate = (
  project: Project,
  config: IterateConfig
): Effect.Effect<IterateResult, NoTasksError | BuildError> =>
  Effect.gen(function* () {
    const emit = (status: IterateStatus) => config.onStatus?.(status)
    const output = (text: string) => config.onOutput?.(text)
    
    // 1. Pick next task
    emit({ type: "picking_task" })
    
    const task = getNextTask(project)
    if (!task) {
      return yield* Effect.fail(new NoTasksError({
        message: "No pending tasks in backlog. Add tasks or generate from goal.",
      }))
    }
    
    // Mark task as in progress
    let updatedProject: Project = {
      ...project,
      currentTaskId: task.id,
      updatedAt: new Date().toISOString(),
      backlog: project.backlog.map(t =>
        t.id === task.id ? { ...t, status: "in_progress" as const } : t
      ),
    }
    
    // 2. Build it (Ralph loop)
    let success = false
    let attempt = 0
    let lastError: string | undefined
    let lastOutput = ""
    let filesChanged: string[] = []
    
    while (!success && attempt < config.maxAttempts) {
      attempt++
      emit({ type: "building", task, attempt })
      output(`\n${"═".repeat(60)}\n`)
      output(`📋 Task: ${task.description}\n`)
      output(`🔄 Attempt ${attempt}/${config.maxAttempts}\n`)
      output(`${"═".repeat(60)}\n\n`)
      
      // Build prompt
      const prompt = buildTaskPrompt(task, updatedProject, attempt, lastError)
      
      // Run agent
      const result: AgentExecutionResult = yield* runAgent(
        prompt,
        config.agent,
        output
      ).pipe(
        Effect.catchAll((error) => Effect.succeed({
          success: false,
          output: "",
          exitCode: 1,
          error: error.message,
          durationMs: 0,
        } satisfies AgentExecutionResult))
      )
      
      lastOutput = result.output
      
      // Create git snapshot to track changes
      const snapshot: DiffSnapshot = yield* createSnapshot(
        config.cwd,
        `Arc: ${task.id} attempt ${attempt}`
      ).pipe(
        Effect.catchAll(() => Effect.succeed({
          hash: "",
          timestamp: Date.now(),
          changes: [],
        } satisfies DiffSnapshot))
      )
      
      filesChanged = snapshot.changes.map(c => c.path)
      
      // Check result
      if (result.success && result.exitCode === 0) {
        // Verify if acceptance criteria exists
        if (task.acceptanceCriteria) {
          emit({ type: "verifying", task })
          // For now, trust the agent. Later: run verification command
          success = true
        } else {
          success = true
        }
      } else {
        lastError = result.error || `Exit code ${result.exitCode}`
        output(`\n❌ Attempt ${attempt} failed: ${lastError}\n`)
      }
    }
    
    // 3. Record outcome
    emit({ type: "recording", task, success })
    
    const outcome = success
      ? `Completed in ${attempt} attempt(s). Files changed: ${filesChanged.join(", ") || "none"}`
      : `Failed after ${attempt} attempts. Last error: ${lastError}`
    
    // Create completed task record
    const completedTask: CompletedTask = {
      id: task.id,
      description: task.description,
      why: task.why,
      acceptanceCriteria: task.acceptanceCriteria,
      size: task.size,
      completedAt: new Date().toISOString(),
      iterations: attempt,
      outcome,
      learnings: success ? undefined : `Blocked: ${lastError}`,
      filesChanged,
    }
    
    // Create iteration record
    const iteration: Iteration = {
      id: `iter-${Date.now()}`,
      taskId: task.id,
      startedAt: updatedProject.updatedAt,
      completedAt: new Date().toISOString(),
      attempts: attempt,
      outcome,
      verified: success,
    }
    
    // 4. Extract insights (could be AI-powered later)
    const insights: Insight[] = []
    if (!success && lastError) {
      insights.push(createInsight(
        `Task "${task.description}" blocked: ${lastError}`,
        { source: task.id, tags: ["blocker"] }
      ))
    }
    
    // 5. Update project
    emit({ type: "updating_plan" })
    
    updatedProject = {
      ...updatedProject,
      updatedAt: new Date().toISOString(),
      currentTaskId: undefined,
      backlog: success
        ? updatedProject.backlog.filter(t => t.id !== task.id)
        : updatedProject.backlog.map(t =>
            t.id === task.id ? { ...t, status: "blocked" as const, blockedBy: lastError } : t
          ),
      completed: success
        ? [...updatedProject.completed, completedTask]
        : updatedProject.completed,
      iterations: [...updatedProject.iterations, iteration],
      insights: [...updatedProject.insights, ...insights],
    }
    
    if (success) {
      emit({ type: "complete", task, iterations: attempt })
      output(`\n✅ Task completed in ${attempt} iteration(s)!\n`)
    } else {
      emit({ type: "failed", task, reason: lastError || "Unknown" })
      output(`\n❌ Task failed after ${attempt} attempts\n`)
    }
    
    return {
      task,
      success,
      iterations: attempt,
      filesChanged,
      outcome,
      insights,
      project: updatedProject,
    }
  })

/**
 * Run iterations until goal is met or no more tasks.
 */
export const iterateUntilDone = (
  project: Project,
  config: IterateConfig,
  options?: {
    maxIterations?: number
    stopOnFailure?: boolean
  }
): Effect.Effect<Project, NoTasksError | BuildError> =>
  Effect.gen(function* () {
    let currentProject = project
    let iterationCount = 0
    const maxIterations = options?.maxIterations ?? 100
    const stopOnFailure = options?.stopOnFailure ?? false
    
    while (iterationCount < maxIterations) {
      const nextTask = getNextTask(currentProject)
      if (!nextTask) {
        // No more tasks
        break
      }
      
      iterationCount++
      
      const result = yield* iterate(currentProject, config).pipe(
        Effect.catchTag("NoTasksError", () => Effect.succeed(null))
      )
      
      if (!result) break
      
      currentProject = result.project
      
      if (!result.success && stopOnFailure) {
        break
      }
    }
    
    return currentProject
  })
