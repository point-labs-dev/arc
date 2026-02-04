/**
 * Project Types
 * 
 * Living project structure for rapid iteration development.
 * The plan evolves with each build cycle.
 */

import { Schema } from "@effect/schema"

// === Task Types ===

export const TaskSize = Schema.Union(
  Schema.Literal("small"),
  Schema.Literal("medium"),
  Schema.Literal("large")
)
export type TaskSize = Schema.Schema.Type<typeof TaskSize>

export const TaskStatus = Schema.Union(
  Schema.Literal("pending"),
  Schema.Literal("in_progress"),
  Schema.Literal("completed"),
  Schema.Literal("blocked"),
  Schema.Literal("dropped")
)
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

export const Task = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  why: Schema.optional(Schema.String),
  acceptanceCriteria: Schema.optional(Schema.String),
  size: Schema.optional(TaskSize),
  status: TaskStatus,
  createdAt: Schema.String,
  blockedBy: Schema.optional(Schema.String),
})
export type Task = Schema.Schema.Type<typeof Task>

export const CompletedTask = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  why: Schema.optional(Schema.String),
  acceptanceCriteria: Schema.optional(Schema.String),
  size: Schema.optional(TaskSize),
  completedAt: Schema.String,
  iterations: Schema.Number,
  outcome: Schema.String,
  learnings: Schema.optional(Schema.String),
  filesChanged: Schema.optional(Schema.Array(Schema.String)),
})
export type CompletedTask = Schema.Schema.Type<typeof CompletedTask>

// === Insight Types ===

export const Insight = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  content: Schema.String,
  source: Schema.optional(Schema.String), // Which task produced this insight
  tags: Schema.optional(Schema.Array(Schema.String)),
})
export type Insight = Schema.Schema.Type<typeof Insight>

// === Iteration Types ===

export const Iteration = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  attempts: Schema.Number,
  outcome: Schema.optional(Schema.String),
  verified: Schema.Boolean,
})
export type Iteration = Schema.Schema.Type<typeof Iteration>

// === Project Types ===

export const ProjectStatus = Schema.Union(
  Schema.Literal("active"),
  Schema.Literal("paused"),
  Schema.Literal("completed"),
  Schema.Literal("abandoned")
)
export type ProjectStatus = Schema.Schema.Type<typeof ProjectStatus>

export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  goal: Schema.String,
  context: Schema.optional(Schema.String),
  status: ProjectStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  
  // Living backlog - ordered by priority
  backlog: Schema.Array(Task),
  
  // Completed work
  completed: Schema.Array(CompletedTask),
  
  // Learnings that shape future work
  insights: Schema.Array(Insight),
  
  // History of iterations
  iterations: Schema.Array(Iteration),
  
  // Current focus (if in progress)
  currentTaskId: Schema.optional(Schema.String),
  
  // Project-level settings
  settings: Schema.optional(Schema.Struct({
    maxIterationsPerTask: Schema.optional(Schema.Number),
    autoVerify: Schema.optional(Schema.Boolean),
    workingDirectory: Schema.optional(Schema.String),
  })),
})
export type Project = Schema.Schema.Type<typeof Project>

// === Helper Functions ===

export const createTask = (
  description: string,
  options?: {
    why?: string
    acceptanceCriteria?: string
    size?: TaskSize
  }
): Task => ({
  id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  description,
  why: options?.why,
  acceptanceCriteria: options?.acceptanceCriteria,
  size: options?.size,
  status: "pending",
  createdAt: new Date().toISOString(),
})

export const createProject = (
  name: string,
  goal: string,
  options?: {
    context?: string
    workingDirectory?: string
  }
): Project => ({
  id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name,
  goal,
  context: options?.context,
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  backlog: [],
  completed: [],
  insights: [],
  iterations: [],
  settings: {
    maxIterationsPerTask: 5,
    autoVerify: true,
    workingDirectory: options?.workingDirectory,
  },
})

export const createInsight = (
  content: string,
  options?: {
    source?: string
    tags?: string[]
  }
): Insight => ({
  id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  content,
  source: options?.source,
  tags: options?.tags,
})

export const getNextTask = (project: Project): Task | null => {
  return project.backlog.find(t => t.status === "pending") ?? null
}

export const getCurrentTask = (project: Project): Task | null => {
  if (!project.currentTaskId) return null
  return project.backlog.find(t => t.id === project.currentTaskId) ?? null
}

export const getProgress = (project: Project): {
  completed: number
  pending: number
  total: number
  percent: number
} => {
  const completed = project.completed.length
  const pending = project.backlog.filter(t => t.status === "pending").length
  const total = completed + pending
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  return { completed, pending, total, percent }
}
