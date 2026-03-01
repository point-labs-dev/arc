# Arc Monitoring UI — Spec (Attractor-aligned)

*Based on Attractor spec §9.5 (HTTP Server Mode) and §9.6 (Observability and Events)*

## Overview

A web-based monitoring dashboard for Arc pipelines. The backend is an HTTP server that wraps the pipeline engine. The frontend consumes SSE event streams and manages pipelines via REST.

## Architecture

```
Browser (React)  ◄── REST + SSE ──►  Arc HTTP Server
                                      Wraps: parseDot(), runPipeline(), validate()
                                      Backends: PiRpcBackend, Interviewer
```

## Backend: HTTP Server (§9.5)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /pipelines | Submit DOT source + config. Starts execution. Returns { id }. |
| GET | /pipelines | List all pipelines (active + completed). |
| GET | /pipelines/:id | Pipeline status, progress, current node, completed nodes, outcomes. |
| GET | /pipelines/:id/events | SSE stream of typed pipeline events (real-time). |
| POST | /pipelines/:id/cancel | Cancel a running pipeline. |
| GET | /pipelines/:id/graph | Rendered pipeline graph as SVG. Current node highlighted. |
| GET | /pipelines/:id/questions | Pending human gate questions. |
| POST | /pipelines/:id/questions/:qid/answer | Submit answer to a human gate question. |
| GET | /pipelines/:id/checkpoint | Current checkpoint state (JSON). |
| GET | /pipelines/:id/context | Current context key-value store (JSON). |

### Request/Response Formats

**POST /pipelines**
```json
{
  "dot": "digraph { ... }",
  "dotPath": "pipelines/convergence.dot",
  "projectRoot": "/path/to/project",
  "config": {
    "model": { "default": "claude-sonnet-4-20250514" }
  }
}
```
Response: `{ "id": "convergence-1709234567890", "status": "running", "startedAt": "..." }`

**GET /pipelines/:id**
```json
{
  "id": "convergence-1709234567890",
  "status": "running",
  "startedAt": "2026-02-28T20:00:00Z",
  "currentNode": "Implement",
  "completedNodes": ["Start", "ReadSpec"],
  "nodeOutcomes": { "ReadSpec": { "status": "success", "output": "..." } },
  "nodeRetries": { "Implement": 1 },
  "elapsed": 142
}
```

**GET /pipelines/:id/events (SSE)**
```
event: StageStarted
data: {"name":"Implement","index":3,"timestamp":"2026-02-28T20:02:15Z"}

event: StageCompleted
data: {"name":"Implement","index":3,"duration":87.2}

event: StageFailed
data: {"name":"Test","index":4,"error":"typecheck failed","will_retry":true}

event: StageRetrying
data: {"name":"Implement","index":3,"attempt":2,"delay":400}

event: InterviewStarted
data: {"question_id":"q1","question":"Approve changes?","stage":"Review","choices":["approve","reject"]}

event: CheckpointSaved
data: {"node_id":"Implement"}

event: PipelineCompleted
data: {"duration":342.5,"artifact_count":4}
```

**GET /pipelines/:id/graph**
Returns `image/svg+xml` — DOT graph rendered as SVG with:
- Current node highlighted (blue border)
- Completed nodes shaded green
- Failed nodes shaded red
- Edges colored by traversal status

**GET /pipelines/:id/questions**
```json
{ "questions": [{ "id": "q1", "stage": "Review", "type": "choice", "text": "Approve?", "choices": ["approve", "reject"] }] }
```

**POST /pipelines/:id/questions/:qid/answer**
Request: `{ "answer": "approve" }` Response: `{ "ok": true }`

### Implementation Notes

- Lightweight HTTP (node:http or Hono)
- SSE via standard text/event-stream
- Graph rendering: shell to `dot -Tsvg` (Graphviz) with state-based node styling
- Pipelines managed in-memory with checkpoint persistence to disk
- Multiple concurrent pipelines supported

## Frontend: Web Dashboard

### Tech Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Zustand (state from SSE stream)
- Inline SVG from /graph endpoint (auto-refreshes on events)
- recharts (analytics)

### Screens

#### 1. Pipeline Dashboard (/)

```
┌─────────────────────────────────────────────────────────┐
│ Arc Monitor                                              │
├──────────────┬──────────────────────────────────────────┤
│  Pipelines   │  Pipeline Graph (SVG from /graph)        │
│  ┌────────┐  │  ┌────────────────────────────────────┐  │
│  │ conv-1 │◄─│  │   [Start] → [ReadSpec] → [Impl]   │  │
│  │ ●run   │  │  │   → [Test] → [Holdout] → [Check]  │  │
│  ├────────┤  │  │   fail→[Persist]→[Impl]            │  │
│  │ conv-2 │  │  │   pass→[Commit]→[More?]→[Exit]    │  │
│  │ ✓done  │  │  └────────────────────────────────────┘  │
│  └────────┘  │                                          │
│              │  Event Stream (SSE)                       │
│  Current:    │  ┌────────────────────────────────────┐  │
│  Implement   │  │ ● StageStarted: Implement          │  │
│  Attempt: 2  │  │ ✓ StageCompleted: Test              │  │
│  Elapsed:    │  │ ✗ StageFailed: Holdout              │  │
│  2m 14s      │  │ ↻ StageRetrying: Implement #2       │  │
│              │  └────────────────────────────────────┘  │
├──────────────┴──────────────────────────────────────────┤
│ ⏸ Human Gate: "Approve changes?" [Approve] [Reject]     │
└─────────────────────────────────────────────────────────┘
```

- Sidebar: pipeline list from GET /pipelines
- Main: SVG graph (auto-refreshes) + SSE event stream
- Bottom: human gate controls (GET /questions, POST /answer)

#### 2. Pipeline Detail (/pipelines/:id)

- Graph SVG with execution state
- Live context values (GET /context)
- Checkpoint state (GET /checkpoint)
- Node outcomes with durations
- Full event log

#### 3. History (/history)

- Past pipelines with outcome, duration
- Filter by status
- Success rate, avg duration

#### 4. Submit (/submit)

- DOT source text area or file path
- Project root, config overrides
- POST /pipelines on submit

### Design

- Dark theme (#0d1117, #161b22)
- Monospace for code/context, sans-serif for UI
- SVG graph is the centerpiece — large, prominent, auto-updating
- Responsive

## Event Types (§9.6)

```typescript
type PipelineEvent =
  | { type: "PipelineStarted"; name: string; id: string }
  | { type: "PipelineCompleted"; duration: number; artifact_count: number }
  | { type: "PipelineFailed"; error: string; duration: number }
  | { type: "StageStarted"; name: string; index: number }
  | { type: "StageCompleted"; name: string; index: number; duration: number }
  | { type: "StageFailed"; name: string; index: number; error: string; will_retry: boolean }
  | { type: "StageRetrying"; name: string; index: number; attempt: number; delay: number }
  | { type: "ParallelStarted"; branch_count: number }
  | { type: "ParallelBranchStarted"; branch: string; index: number }
  | { type: "ParallelBranchCompleted"; branch: string; index: number; duration: number; success: boolean }
  | { type: "ParallelCompleted"; duration: number; success_count: number; failure_count: number }
  | { type: "InterviewStarted"; question_id: string; question: string; stage: string; choices?: string[] }
  | { type: "InterviewCompleted"; question_id: string; answer: string; duration: number }
  | { type: "InterviewTimeout"; question_id: string; stage: string; duration: number }
  | { type: "CheckpointSaved"; node_id: string }
```

## Build Order

1. HTTP Server — REST + SSE wrapping runPipeline()
2. Graph renderer — dot -Tsvg with execution state styling
3. UI scaffold — Vite + React + Tailwind + shadcn/ui
4. Dashboard — Pipeline list + graph SVG + event stream + human gates
5. Detail view — Context, checkpoint, outcomes, full log
6. History — Past pipeline browser
7. Submit — Form to start pipelines via REST
