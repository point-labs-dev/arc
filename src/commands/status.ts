/**
 * Status Command
 * 
 * Show project status and progress.
 */

import { Effect } from "effect"
import {
  loadProject,
  projectExists,
  getProjectStats,
  getRecentActivity,
} from "../core/project-store"
import { getNextTask, getProgress } from "../types/project"

export const runStatusCommand = (
  options: {
    projectFile?: string
  } = {}
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const cwd = process.cwd()
    
    // Check if project exists
    if (!projectExists(cwd, options.projectFile)) {
      console.error(`\n❌ No project found in current directory`)
      console.error(`   Run 'arc init "your goal"' first`)
      return
    }
    
    // Load project
    const project = yield* loadProject(cwd, options.projectFile).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    const stats = getProjectStats(project)
    const progress = getProgress(project)
    const nextTask = getNextTask(project)
    const recentActivity = getRecentActivity(project, 5)
    
    console.log(`\n⚡ Arc Project Status`)
    console.log(`${"═".repeat(50)}`)
    console.log(``)
    console.log(`📋 Project: ${project.name}`)
    console.log(`🎯 Goal: ${project.goal}`)
    console.log(`📊 Status: ${project.status}`)
    console.log(``)
    
    // Progress bar
    const barWidth = 30
    const filled = Math.round((progress.percent / 100) * barWidth)
    const empty = barWidth - filled
    const bar = "█".repeat(filled) + "░".repeat(empty)
    console.log(`Progress: [${bar}] ${progress.percent}%`)
    console.log(`          ${progress.completed} completed, ${progress.pending} pending`)
    console.log(``)
    
    // Stats
    console.log(`📈 Statistics`)
    console.log(`   Total iterations: ${stats.totalIterations}`)
    console.log(`   Avg iterations/task: ${stats.averageIterationsPerTask}`)
    console.log(`   Blocked tasks: ${stats.blockedTasks}`)
    console.log(`   Insights collected: ${stats.totalInsights}`)
    console.log(``)
    
    // Next task
    if (nextTask) {
      console.log(`⏭️  Next Task`)
      console.log(`   ${nextTask.description}`)
      if (nextTask.size) {
        console.log(`   Size: ${nextTask.size}`)
      }
      console.log(``)
    } else if (progress.pending === 0 && progress.completed > 0) {
      console.log(`🎉 All tasks completed!`)
      console.log(``)
    } else {
      console.log(`📭 No tasks in backlog`)
      console.log(`   Add tasks with: arc add "task description"`)
      console.log(``)
    }
    
    // Recent activity
    if (recentActivity.length > 0) {
      console.log(`📜 Recent Activity`)
      for (const activity of recentActivity) {
        const icon = activity.type === "completed" ? "✅" : activity.type === "insight" ? "💡" : "🔄"
        const time = new Date(activity.timestamp).toLocaleString()
        console.log(`   ${icon} ${activity.description}`)
        console.log(`      ${time}`)
      }
      console.log(``)
    }
    
    console.log(`${"═".repeat(50)}`)
    console.log(`Commands: arc iterate | arc add "task" | arc backlog | arc insights`)
    console.log(``)
  })
