/**
 * Project Store
 * 
 * Persistence layer for projects.
 * Stores project state in JSON files.
 */

import { Effect } from "effect"
import { Data } from "effect"
import * as fs from "fs"
import * as path from "path"
import type { Project, Task, Insight } from "../types/project"
import { createProject, createTask, createInsight } from "../types/project"

// === Errors ===

export class ProjectNotFoundError extends Data.TaggedError("ProjectNotFoundError")<{
  readonly message: string
  readonly path: string
}> {}

export class ProjectParseError extends Data.TaggedError("ProjectParseError")<{
  readonly message: string
  readonly path: string
}> {}

export class ProjectWriteError extends Data.TaggedError("ProjectWriteError")<{
  readonly message: string
  readonly path: string
}> {}

// === Constants ===

const DEFAULT_PROJECT_FILE = "arc-project.json"

// === Load/Save ===

/**
 * Get the project file path for a directory.
 */
export const getProjectPath = (cwd: string, filename?: string): string => {
  return path.join(cwd, filename ?? DEFAULT_PROJECT_FILE)
}

/**
 * Check if a project exists in a directory.
 */
export const projectExists = (cwd: string, filename?: string): boolean => {
  return fs.existsSync(getProjectPath(cwd, filename))
}

/**
 * Load a project from disk.
 */
export const loadProject = (
  cwd: string,
  filename?: string
): Effect.Effect<Project, ProjectNotFoundError | ProjectParseError> =>
  Effect.gen(function* () {
    const projectPath = getProjectPath(cwd, filename)
    
    if (!fs.existsSync(projectPath)) {
      return yield* Effect.fail(new ProjectNotFoundError({
        message: `Project not found at ${projectPath}`,
        path: projectPath,
      }))
    }
    
    try {
      const content = fs.readFileSync(projectPath, "utf-8")
      const project = JSON.parse(content) as Project
      return project
    } catch (e) {
      return yield* Effect.fail(new ProjectParseError({
        message: `Failed to parse project: ${e instanceof Error ? e.message : "Unknown"}`,
        path: projectPath,
      }))
    }
  })

/**
 * Save a project to disk.
 */
export const saveProject = (
  project: Project,
  cwd: string,
  filename?: string
): Effect.Effect<void, ProjectWriteError> =>
  Effect.gen(function* () {
    const projectPath = getProjectPath(cwd, filename)
    
    try {
      const content = JSON.stringify(project, null, 2)
      fs.writeFileSync(projectPath, content, "utf-8")
    } catch (e) {
      return yield* Effect.fail(new ProjectWriteError({
        message: `Failed to save project: ${e instanceof Error ? e.message : "Unknown"}`,
        path: projectPath,
      }))
    }
  })

/**
 * Initialize a new project.
 */
export const initProject = (
  cwd: string,
  name: string,
  goal: string,
  options?: {
    context?: string
    filename?: string
  }
): Effect.Effect<Project, ProjectWriteError> =>
  Effect.gen(function* () {
    const project = createProject(name, goal, {
      context: options?.context,
      workingDirectory: cwd,
    })
    
    yield* saveProject(project, cwd, options?.filename)
    
    return project
  })

// === Mutations ===

/**
 * Add a task to the project backlog.
 */
export const addTask = (
  project: Project,
  description: string,
  options?: {
    why?: string
    acceptanceCriteria?: string
    size?: "small" | "medium" | "large"
    insertAt?: "top" | "bottom" | number
  }
): Project => {
  const task = createTask(description, options)
  
  let backlog: Task[]
  if (options?.insertAt === "top") {
    backlog = [task, ...project.backlog]
  } else if (typeof options?.insertAt === "number") {
    backlog = [
      ...project.backlog.slice(0, options.insertAt),
      task,
      ...project.backlog.slice(options.insertAt),
    ]
  } else {
    backlog = [...project.backlog, task]
  }
  
  return {
    ...project,
    backlog,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Remove a task from the backlog.
 */
export const removeTask = (project: Project, taskId: string): Project => ({
  ...project,
  backlog: project.backlog.filter(t => t.id !== taskId),
  updatedAt: new Date().toISOString(),
})

/**
 * Reorder tasks in the backlog.
 */
export const reorderTasks = (project: Project, taskIds: string[]): Project => {
  const taskMap = new Map(project.backlog.map(t => [t.id, t]))
  const reordered = taskIds
    .map(id => taskMap.get(id))
    .filter((t): t is Task => t !== undefined)
  
  // Add any tasks not in the new order at the end
  const remaining = project.backlog.filter(t => !taskIds.includes(t.id))
  
  return {
    ...project,
    backlog: [...reordered, ...remaining],
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Add an insight to the project.
 */
export const addInsight = (
  project: Project,
  content: string,
  options?: {
    source?: string
    tags?: string[]
  }
): Project => ({
  ...project,
  insights: [...project.insights, createInsight(content, options)],
  updatedAt: new Date().toISOString(),
})

/**
 * Update project goal or context.
 */
export const updateProject = (
  project: Project,
  updates: {
    name?: string
    goal?: string
    context?: string
    status?: Project["status"]
  }
): Project => ({
  ...project,
  ...updates,
  updatedAt: new Date().toISOString(),
})

// === Queries ===

/**
 * Get project statistics.
 */
export const getProjectStats = (project: Project): {
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  blockedTasks: number
  totalIterations: number
  averageIterationsPerTask: number
  totalInsights: number
} => {
  const completedTasks = project.completed.length
  const pendingTasks = project.backlog.filter(t => t.status === "pending").length
  const blockedTasks = project.backlog.filter(t => t.status === "blocked").length
  const totalTasks = completedTasks + project.backlog.length
  const totalIterations = project.iterations.length
  const averageIterationsPerTask = completedTasks > 0
    ? totalIterations / completedTasks
    : 0
  
  return {
    totalTasks,
    completedTasks,
    pendingTasks,
    blockedTasks,
    totalIterations,
    averageIterationsPerTask: Math.round(averageIterationsPerTask * 10) / 10,
    totalInsights: project.insights.length,
  }
}

/**
 * Get recent activity.
 */
export const getRecentActivity = (
  project: Project,
  limit = 10
): Array<{
  type: "completed" | "iteration" | "insight"
  timestamp: string
  description: string
}> => {
  const activities: Array<{
    type: "completed" | "iteration" | "insight"
    timestamp: string
    description: string
  }> = []
  
  for (const task of project.completed) {
    activities.push({
      type: "completed",
      timestamp: task.completedAt,
      description: `Completed: ${task.description}`,
    })
  }
  
  for (const insight of project.insights) {
    activities.push({
      type: "insight",
      timestamp: insight.timestamp,
      description: `Insight: ${insight.content}`,
    })
  }
  
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}
