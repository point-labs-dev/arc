/**
 * Go Command
 * 
 * Keep iterating until all tasks are done or blocked.
 * This is the "hands-off" mode.
 */

import { Effect } from "effect"
import {
  loadProject,
  saveProject,
  projectExists,
  getProjectStats,
} from "../core/project-store"
import { iterateUntilDone, type IterateConfig } from "../core/iterate"
import { getNextTask, getProgress } from "../types/project"
import type { AgentType, AgentConfig } from "../agents"

export const runGoCommand = (
  options: {
    agent?: AgentType
    maxAttempts?: number
    provider?: string
    model?: string
    autoApprove?: boolean
    projectFile?: string
    maxTasks?: number
    stopOnFailure?: boolean
  } = {}
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const cwd = process.cwd()
    const agent = options.agent ?? "claude-code"
    const maxAttempts = options.maxAttempts ?? 5
    const maxTasks = options.maxTasks ?? 100
    const stopOnFailure = options.stopOnFailure ?? false
    
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
      console.log(`   Add tasks with: arc add "task description"`)
      return
    }
    
    const initialProgress = getProgress(project)
    
    console.log(`\n⚡ Arc Go - Continuous Iteration`)
    console.log(`${"═".repeat(60)}`)
    console.log(``)
    console.log(`🎯 Goal: ${project.goal}`)
    console.log(`📋 Tasks: ${initialProgress.pending} pending`)
    console.log(`🤖 Agent: ${agent}${options.provider ? ` (${options.provider})` : ""}`)
    console.log(`🔄 Max attempts per task: ${maxAttempts}`)
    console.log(`⏹️  Stop on failure: ${stopOnFailure ? "yes" : "no"}`)
    console.log(``)
    console.log(`Press Ctrl+C to stop at any time`)
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
    
    // Run until done
    const finalProject = yield* iterateUntilDone(project, iterateConfig, {
      maxIterations: maxTasks,
      stopOnFailure,
    }).pipe(
      Effect.catchAll((error) => {
        console.error(`\n❌ Error: ${error.message}`)
        return Effect.succeed(project)
      })
    )
    
    // Save final state
    yield* saveProject(finalProject, cwd, options.projectFile).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    // Final summary
    const finalStats = getProjectStats(finalProject)
    const finalProgress = getProgress(finalProject)
    
    console.log(`\n${"═".repeat(60)}`)
    console.log(``)
    console.log(`🏁 Arc Go Complete`)
    console.log(``)
    console.log(`📊 Results:`)
    console.log(`   Tasks completed: ${finalStats.completedTasks}`)
    console.log(`   Tasks blocked: ${finalStats.blockedTasks}`)
    console.log(`   Total iterations: ${finalStats.totalIterations}`)
    console.log(`   Insights gathered: ${finalStats.totalInsights}`)
    console.log(``)
    
    // Progress bar
    const barWidth = 30
    const filled = Math.round((finalProgress.percent / 100) * barWidth)
    const empty = barWidth - filled
    const bar = "█".repeat(filled) + "░".repeat(empty)
    console.log(`Progress: [${bar}] ${finalProgress.percent}%`)
    console.log(``)
    
    if (finalProgress.pending === 0 && finalStats.blockedTasks === 0) {
      console.log(`🎉 All tasks completed successfully!`)
    } else if (finalStats.blockedTasks > 0) {
      console.log(`⚠️  Some tasks are blocked. Review with 'arc backlog'`)
    } else {
      console.log(`⏸️  Stopped with ${finalProgress.pending} tasks remaining`)
    }
    
    console.log(``)
    console.log(`Commands: arc status | arc backlog | arc insights`)
    console.log(``)
  })
