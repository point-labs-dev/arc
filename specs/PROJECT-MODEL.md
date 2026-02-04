# Project Model Specification

## Overview

The project model represents the living state of a development effort. Unlike static plans, the project evolves with each iteration.

## Core Types

### Project

```typescript
interface Project {
  id: string
  name: string
  goal: string                    // The big idea
  context?: string                // Additional context
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  
  backlog: Task[]                 // Living backlog - ordered by priority
  completed: CompletedTask[]      // What's been done
  insights: Insight[]             // Learnings that shape future work
  iterations: Iteration[]         // History of iterations
  
  currentTaskId?: string          // Currently in progress
  settings?: ProjectSettings
}

type ProjectStatus = "active" | "paused" | "completed" | "abandoned"
```

### Task

```typescript
interface Task {
  id: string
  description: string
  why?: string                    // Why this matters now
  acceptanceCriteria?: string     // Verification command
  size?: "small" | "medium" | "large"
  status: TaskStatus
  createdAt: string
  blockedBy?: string              // Error message if blocked
}

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "dropped"
```

### CompletedTask

```typescript
interface CompletedTask {
  id: string
  description: string
  why?: string
  acceptanceCriteria?: string
  size?: TaskSize
  completedAt: string
  iterations: number              // How many tries
  outcome: string                 // What actually happened
  learnings?: string              // What we learned
  filesChanged?: string[]         // Files modified
}
```

### Insight

```typescript
interface Insight {
  id: string
  timestamp: string
  content: string                 // The learning
  source?: string                 // Which task produced this
  tags?: string[]                 // Categories (e.g., "blocker", "optimization")
}
```

### Iteration

```typescript
interface Iteration {
  id: string
  taskId: string
  startedAt: string
  completedAt?: string
  attempts: number
  outcome?: string
  verified: boolean
}
```

## File Format

Projects are stored as JSON files (default: `arc-project.json`):

```json
{
  "id": "project-1706...",
  "name": "my-api",
  "goal": "Build a REST API for todos",
  "status": "active",
  "createdAt": "2026-02-03T...",
  "updatedAt": "2026-02-03T...",
  "backlog": [
    {
      "id": "task-1706...",
      "description": "Set up Express server",
      "acceptanceCriteria": "curl localhost:3000/health",
      "status": "pending",
      "createdAt": "2026-02-03T..."
    }
  ],
  "completed": [],
  "insights": [],
  "iterations": []
}
```

## Invariants

1. A task can only be in `backlog` OR `completed`, never both
2. `currentTaskId` must reference a task in `backlog` with status `in_progress`
3. Completed tasks preserve full history (iterations, learnings)
4. Insights are append-only (never deleted)

## Mutations

| Operation | Description |
|-----------|-------------|
| `addTask` | Add task to backlog |
| `removeTask` | Remove task from backlog |
| `reorderTasks` | Change backlog priority |
| `completeTask` | Move task to completed |
| `blockTask` | Mark task as blocked |
| `addInsight` | Record a learning |
| `updateProject` | Update goal/context/status |

## Queries

| Query | Description |
|-------|-------------|
| `getNextTask` | Get next pending task |
| `getCurrentTask` | Get in-progress task |
| `getProgress` | Get completion percentage |
| `getProjectStats` | Get statistics |
| `getRecentActivity` | Get recent events |

## Related Specs

- [PROJECT-PERSISTENCE](./PROJECT-PERSISTENCE.md) - Storage format
- [ITERATION-LOOP](./ITERATION-LOOP.md) - How projects are processed
