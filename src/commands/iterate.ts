/**
 * Iterate Command
 * 
 * Run one iteration of the development loop:
 * 1. Pick next task
 * 2. Build it (Ralph loop until verified)
 * 3. Record outcome + learnings
 * 4. Update plan
 */

import { Effect } from "effect"
import {
  loadProject,
  saveProject,
  projectExists,
  addTask,
} from "../core/project-store"
import { iterate, type IterateConfig, type IterateStatus } from "../core/iterate"
import { getNextTask, createTask } from "../types/project"
import type { AgentType, AgentConfig } from "../agents"

export const runIterateCommand = (
  options: {
    agent?: AgentType
    maxAttempts?: number
    provider?: string
    model?: string
    autoApprove?: boolean
    projectFile?: string
  } = {}
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const cwd = process.cwd()
    const agent = options.agent ?? "claude-code"
    const maxAttempts = options.maxAttempts ?? 5
    
    // Check if project exists
    if (!projectExists(cwd, options.projectFile)) {
      console.error(`\n❌ No project found in current directory`)
      console.error(`   Run 'arc init "your goal"' first`)
      return
    }
    
    // Load project
    let project = yield* loadProject(cwd, options.projectFile).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    // Check if there are tasks
    const nextTask = getNextTask(project)
    if (!nextTask) {
      console.log(`\n📭 No pending tasks in backlog`)
      console.log(``)
      console.log(`Options:`)
      console.log(`  1. Add tasks manually: arc add "task description"`)
      console.log(`  2. The AI will suggest a task based on your goal...`)
      console.log(``)
      
      // TODO: Auto-generate task from goal using AI
      // For now, prompt user to add tasks
      return
    }
    
    console.log(`\n⚡ Arc Iterate`)
    console.log(`${"═".repeat(60)}`)
    console.log(``)
    console.log(`🎯 Goal: ${project.goal}`)
    console.log(`📋 Task: ${nextTask.description}`)
    console.log(`🤖 Agent: ${agent}${options.provider ? ` (${options.provider})` : ""}`)
    console.log(`🔄 Max attempts: ${maxAttempts}`)
    console.log(``)
    console.log(`${"═".repeat(60)}`)
    
    // Configure agent
    const agentConfig: AgentConfig = {
      agent,
      cwd,
      autoApprove: options.autoApprove,
      timeout: 300000,
      provider: options.provider,
      model: options.model,
    }
    
    // Configure iteration
    const iterateConfig: IterateConfig = {
      cwd,
      agent: agentConfig,
      maxAttempts,
      onOutput: (text) => process.stdout.write(text),
      onStatus: (status) => {
        // Could update a TUI here
      },
    }
    
    // Run iteration
    const result = yield* iterate(project, iterateConfig).pipe(
      Effect.catchAll((error) => {
        if (error._tag === "NoTasksError") {
          console.log(`\n📭 ${error.message}`)
          return Effect.succeed(null)
        }
        return Effect.fail(new Error(error.message))
      })
    )
    
    if (!result) return
    
    // Save updated project
    yield* saveProject(result.project, cwd, options.projectFile).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    // Summary
    console.log(`\n${"═".repeat(60)}`)
    console.log(``)
    if (result.success) {
      console.log(`✅ Task completed in ${result.iterations} iteration(s)`)
    } else {
      console.log(`❌ Task failed after ${result.iterations} attempt(s)`)
    }
    console.log(``)
    console.log(`📝 Outcome: ${result.outcome}`)
    if (result.filesChanged.length > 0) {
      console.log(`📁 Files changed: ${result.filesChanged.join(", ")}`)
    }
    if (result.insights.length > 0) {
      console.log(`💡 New insights: ${result.insights.length}`)
    }
    console.log(``)
    
    // What's next
    const remaining = result.project.backlog.filter(t => t.status === "pending").length
    if (remaining > 0) {
      console.log(`⏭️  ${remaining} task(s) remaining`)
      console.log(`   Run 'arc iterate' for next task, or 'arc go' to keep going`)
    } else {
      console.log(`🎉 All tasks completed!`)
      console.log(`   Run 'arc status' to see summary`)
    }
    console.log(``)
  })
