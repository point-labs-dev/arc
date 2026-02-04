/**
 * Add Command
 * 
 * Add a task to the project backlog.
 */

import { Effect } from "effect"
import {
  loadProject,
  saveProject,
  addTask,
  projectExists,
} from "../core/project-store"

export const runAddCommand = (
  description: string,
  options: {
    projectFile?: string
    why?: string
    acceptanceCriteria?: string
    size?: "small" | "medium" | "large"
    top?: boolean
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
    
    // Add the task
    const updatedProject = addTask(project, description, {
      why: options.why,
      acceptanceCriteria: options.acceptanceCriteria,
      size: options.size,
      insertAt: options.top ? "top" : "bottom",
    })
    
    // Save
    yield* saveProject(updatedProject, cwd, options.projectFile).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    const newTask = updatedProject.backlog[updatedProject.backlog.length - 1]
    const position = options.top ? "top" : "bottom"
    
    console.log(`\n✅ Task added to ${position} of backlog`)
    console.log(``)
    console.log(`📋 ${description}`)
    if (options.size) {
      console.log(`📏 Size: ${options.size}`)
    }
    if (options.acceptanceCriteria) {
      console.log(`✓  Verify: ${options.acceptanceCriteria}`)
    } else {
      console.log(`⚠️  No acceptance criteria - will need manual verification`)
      console.log(`   Tip: Add verification command for auto-verify`)
      console.log(`   Example: arc add "Build API" --verify "curl localhost:3000/health"`)
    }
    console.log(``)
    console.log(`Backlog now has ${updatedProject.backlog.length} task(s)`)
    console.log(`Run 'arc iterate' to work on the next task`)
    console.log(``)
  })
