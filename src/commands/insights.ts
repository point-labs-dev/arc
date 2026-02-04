/**
 * Insights Command
 * 
 * Show learnings and insights from the project.
 */

import { Effect } from "effect"
import {
  loadProject,
  projectExists,
} from "../core/project-store"

export const runInsightsCommand = (
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
    
    console.log(`\n⚡ Arc Insights`)
    console.log(`${"═".repeat(50)}`)
    console.log(``)
    
    if (project.insights.length === 0) {
      console.log(`💡 No insights yet`)
      console.log(``)
      console.log(`Insights are collected as you iterate.`)
      console.log(`Run 'arc iterate' to start building.`)
    } else {
      console.log(`💡 ${project.insights.length} insight(s)`)
      console.log(``)
      
      // Group by tags if available
      const taggedInsights = new Map<string, Array<typeof project.insights[number]>>()
      const untagged: Array<typeof project.insights[number]> = []
      
      for (const insight of project.insights) {
        if (insight.tags && insight.tags.length > 0) {
          for (const tag of insight.tags) {
            if (!taggedInsights.has(tag)) {
              taggedInsights.set(tag, [])
            }
            taggedInsights.get(tag)!.push(insight)
          }
        } else {
          untagged.push(insight)
        }
      }
      
      // Show tagged insights
      for (const [tag, insights] of taggedInsights) {
        console.log(`📌 ${tag.toUpperCase()}`)
        for (const insight of insights) {
          const time = new Date(insight.timestamp).toLocaleDateString()
          console.log(`   • ${insight.content}`)
          console.log(`     ${time}${insight.source ? ` (from ${insight.source})` : ""}`)
        }
        console.log(``)
      }
      
      // Show untagged insights
      if (untagged.length > 0) {
        console.log(`📝 General`)
        for (const insight of untagged) {
          const time = new Date(insight.timestamp).toLocaleDateString()
          console.log(`   • ${insight.content}`)
          console.log(`     ${time}${insight.source ? ` (from ${insight.source})` : ""}`)
        }
        console.log(``)
      }
    }
    
    console.log(``)
  })
