import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { loadArcConfig } from "./config"
import { loadProgressState, readRecentLearnings } from "./progress"

export interface ProjectStatus {
  readonly configMode: string
  readonly attempts: number
  readonly completedItems: readonly string[]
  readonly pendingItems: readonly string[]
  readonly lastAttemptAt: string | null
  readonly overallSatisfaction: number
  readonly recentLearnings: readonly string[]
}

export const readProjectStatus = async (projectRoot: string): Promise<ProjectStatus> => {
  const specPath = join(projectRoot, "SPEC.md")
  const specText = await readFile(specPath, "utf8")
  const config = await loadArcConfig({ projectRoot })
  const progress = await loadProgressState(projectRoot, specText)
  const recentLearnings = await readRecentLearnings(projectRoot, 2)

  return {
    configMode: config.backend.mode,
    attempts: progress.totalAttempts,
    completedItems: progress.specItemsCompleted,
    pendingItems: progress.specItemsPending,
    lastAttemptAt: progress.lastAttemptAt,
    overallSatisfaction: progress.overallSatisfaction,
    recentLearnings,
  }
}
