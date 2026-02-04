/**
 * Init Command
 * 
 * Initialize a new Arc project with a goal.
 */

import { Effect } from "effect"
import {
  initProject,
  projectExists,
  getProjectPath,
} from "../core/project-store"

export const runInitCommand = (
  goal: string,
  options: {
    projectFile?: string
  } = {}
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const cwd = process.cwd()
    
    // Check if project already exists
    if (projectExists(cwd, options.projectFile)) {
      const projectPath = getProjectPath(cwd, options.projectFile)
      console.error(`\n❌ Project already exists: ${projectPath}`)
      console.error(`   Use 'arc status' to see current project`)
      console.error(`   Or delete the file to start fresh`)
      return
    }
    
    // Extract project name from current directory
    const name = cwd.split("/").pop() || "project"
    
    // Create the project
    const project = yield* initProject(cwd, name, goal, {
      filename: options.projectFile,
    }).pipe(
      Effect.mapError((e) => new Error(e.message))
    )
    
    console.log(`\n⚡ Arc Project Initialized`)
    console.log(``)
    console.log(`📋 Project: ${project.name}`)
    console.log(`🎯 Goal: ${project.goal}`)
    console.log(`📁 File: ${getProjectPath(cwd, options.projectFile)}`)
    console.log(``)
    console.log(`Next steps:`)
    console.log(`  1. Add tasks:    arc add "Set up project structure"`)
    console.log(`  2. Or iterate:   arc iterate  (AI will suggest tasks)`)
    console.log(`  3. Check status: arc status`)
    console.log(``)
  })
