/**
 * Backlog Command
 * 
 * Show the task backlog.
 */

import { Effect } from "effect"
import {
  loadProject,
  projectExists,
} from "../core/project-store"

export const runBacklogCommand = (
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
    
    console.log(`\n⚡ Arc Backlog`)
    console.log(`${"═".repeat(50)}`)
    console.log(``)
    
    if (project.backlog.length === 0) {
      console.log(`📭 Backlog is empty`)
      console.log(``)
      console.log(`Add tasks with: arc add "task description"`)
    } else {
      console.log(`📋 ${project.backlog.length} task(s) in backlog`)
      console.log(``)
      
      for (let i = 0; i < project.backlog.length; i++) {
        const task = project.backlog[i]
        const statusIcon = task.status === "pending" ? "⏳" :
                          task.status === "in_progress" ? "🔄" :
                          task.status === "blocked" ? "🚫" :
                          task.status === "completed" ? "✅" : "❌"
        const sizeLabel = task.size ? ` [${task.size}]` : ""
        
        console.log(`${i + 1}. ${statusIcon} ${task.description}${sizeLabel}`)
        
        if (task.why) {
          console.log(`      Why: ${task.why}`)
        }
        if (task.acceptanceCriteria) {
          console.log(`      Done when: ${task.acceptanceCriteria}`)
        }
        if (task.status === "blocked" && task.blockedBy) {
          console.log(`      Blocked: ${task.blockedBy}`)
        }
        console.log(``)
      }
    }
    
    // Show completed count
    if (project.completed.length > 0) {
      console.log(`${"─".repeat(50)}`)
      console.log(`✅ ${project.completed.length} task(s) completed`)
    }
    
    console.log(``)
  })
