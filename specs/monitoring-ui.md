# Arc Monitoring UI — Spec (Attractor §9.5/§9.6)

## Overview

Web-based monitoring for Arc pipelines. HTTP server wraps the engine (REST + SSE). React dashboard consumes the API. DOT graph rendered client-side via WASM.

## Architecture

```
Browser (React + @hpcc-js/wasm-graphviz)
  ├── EventSource → /pipelines/:id/events (SSE)
  ├── fetch → REST endpoints
  └── WASM DOT→SVG rendering (client-side, no Graphviz install)
      │
      ▼
Arc HTTP Server (Hono)
  ├── REST: pipeline management
  ├── SSE: Attractor event streaming
  └── Wraps: parseDot(), runPipeline(), validate()
```

## Stack

### Server
- **Hono** — lightweight HTTP framework, built-in `streamSSE` helper
- **Node.js** — runs alongside or embedded in CLI (`arc serve`)

### Client
- **Vite + React 19 + TypeScript**
- **Tailwind CSS v4 + shadcn/ui**
- **@hpcc-js/wasm-graphviz** — client-side DOT→SVG rendering (no server Graphviz dependency)
- **Zustand** — state management (SSE events accumulate into store)
- **EventSource** — native browser SSE with auto-reconnect
- **recharts** — analytics charts

## Server: REST + SSE Endpoints

### Pipeline Management

| Method | Path | Description |
|--------|------|-------------|
| POST | /pipelines | Submit DOT source + config. Starts execution. Returns `{ id }`. |
| GET | /pipelines | List all pipelines (active + completed). |
| GET | /pipelines/:id | Pipeline status, progress, current node, outcomes. |
| POST | /pipelines/:id/cancel | Cancel a running pipeline. |
| DELETE | /pipelines/:id | Remove a completed pipeline from history. |

### Live Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | /pipelines/:id/events | **SSE stream** of Attractor-typed events. |
| GET | /pipelines/:id/graph | DOT source + execution state (JSON). Client renders SVG. |
| GET | /pipelines/:id/checkpoint | Current checkpoint state (JSON). |
| GET | /pipelines/:id/context | Current context key-value store (JSON). |

### Human Gates

| Method | Path | Description |
|--------|------|-------------|
| GET | /pipelines/:id/questions | Pending human gate questions. |
| POST | /pipelines/:id/questions/:qid/answer | Submit answer to a human gate question. |

### Request/Response

**POST /pipelines**
```json
{
  "dotPath": "pipelines/convergence.dot",
  "projectRoot": "/path/to/project",
  "config": {}
}
```
→ `{ "id": "conv-1709234567890", "status": "running" }`

**GET /pipelines/:id**
```json
{
  "id": "conv-1709234567890",
  "status": "running",
  "startedAt": "2026-02-28T20:00:00Z",
  "currentNode": "Implement",
  "completedNodes": ["Start", "ReadSpec"],
  "nodeOutcomes": { "ReadSpec": { "status": "success" } },
  "nodeRetries": { "Implement": 1 },
  "elapsedSec": 142
}
```

**GET /pipelines/:id/events (SSE)**

Uses Hono's `streamSSE`:
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
data: {"question_id":"q1","question":"Approve?","stage":"Review","choices":["approve","reject"]}

event: CheckpointSaved
data: {"node_id":"Implement"}

event: PipelineCompleted
data: {"duration":342.5,"artifact_count":4}
```

**GET /pipelines/:id/graph**
```json
{
  "dot": "digraph ArcConvergence { ... }",
  "executionState": {
    "currentNode": "Implement",
    "completedNodes": ["Start", "ReadSpec"],
    "failedNodes": [],
    "retryingNodes": ["Implement"],
    "nodeOutcomes": { "ReadSpec": { "status": "success" } }
  }
}
```
Client uses `@hpcc-js/wasm-graphviz` to render DOT→SVG, then applies CSS classes based on `executionState` to color nodes.

### Server Implementation Notes

```typescript
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { cors } from "hono/cors"
import { runPipeline } from "../engine/index"
import { PiRpcBackend } from "../backends/pi-rpc"

const app = new Hono()
app.use("/*", cors())

// SSE endpoint
app.get("/pipelines/:id/events", (c) => {
  const pipeline = pipelines.get(c.req.param("id"))
  return streamSSE(c, async (stream) => {
    const handler = (event: PipelineEvent) => {
      stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
        id: String(Date.now()),
      })
    }
    pipeline.emitter.on("event", handler)
    // Keep alive until pipeline completes or client disconnects
    await new Promise((resolve) => {
      pipeline.emitter.on("PipelineCompleted", resolve)
      pipeline.emitter.on("PipelineFailed", resolve)
    })
  })
})
```

- Pipelines stored in-memory `Map<string, PipelineRun>`
- Each run has its own event emitter
- SSE connections cleaned up on pipeline completion
- Human gate: `Interviewer` implementation holds questions in a `Map`, resolves Promise when REST answer arrives

## Client: React Dashboard

### Layout (Dagster-inspired)

```
┌─────────────────────────────────────────────────────────┐
│ Arc Monitor                              [+ New Pipeline]│
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Pipelines   │  Pipeline Graph (DOT→SVG via WASM)      │
│  ┌────────┐  │  ┌────────────────────────────────────┐  │
│  │ conv-1 │◄─│  │   ● Start → ✓ ReadSpec             │  │
│  │ ●run   │  │  │     → ↻ Implement ← ─ ─ ─ ┐      │  │
│  ├────────┤  │  │     → ○ Test               │      │  │
│  │ conv-2 │  │  │     → ○ Holdout             │      │  │
│  │ ✓done  │  │  │     → ○ Check ── fail ─ ─ ─┘      │  │
│  ├────────┤  │  │     → ○ Commit → ○ Exit            │  │
│  │ conv-3 │  │  └────────────────────────────────────┘  │
│  │ ✗fail  │  │                                          │
│  └────────┘  │  Click node → expand detail panel        │
│              │                                          │
│  Status:     ├──────────────────────────────────────────┤
│  Implement   │                                          │
│  Attempt: 2  │  Event Stream (SSE via EventSource)      │
│  Elapsed:    │  ┌────────────────────────────────────┐  │
│  2m 14s      │  │ 20:02:15 ● StageStarted: Implement │  │
│              │  │ 20:03:42 ✓ StageCompleted: Test     │  │
│              │  │ 20:03:50 ✗ StageFailed: Holdout     │  │
│              │  │ 20:03:51 ↻ StageRetrying: #2        │  │
│              │  └────────────────────────────────────┘  │
├──────────────┴──────────────────────────────────────────┤
│ ⏸ Human Gate: "Approve changes?" [Approve] [Reject]     │
└─────────────────────────────────────────────────────────┘
```

### Screens

#### 1. Dashboard (`/`)

**Pipeline sidebar (left):**
- `GET /pipelines` → list with status badges (● running, ✓ done, ✗ fail)
- Click to select → updates graph + events
- Shows: current node, attempt count, elapsed time

**Pipeline graph (top-right):**
- `GET /pipelines/:id/graph` returns DOT + execution state
- Client renders with `@hpcc-js/wasm-graphviz`:
  ```typescript
  import { Graphviz } from "@hpcc-js/wasm-graphviz"
  const graphviz = await Graphviz.load()
  const svg = graphviz.dot(dotSource)
  ```
- Apply CSS classes to SVG nodes based on execution state:
  - `.completed` → green fill
  - `.running` → blue border, pulsing animation
  - `.failed` → red fill
  - `.retrying` → yellow border
  - `.pending` → gray
- Auto-refreshes on SSE `StageStarted`/`StageCompleted` events
- Click a node → expand detail panel (outcome, duration, retries, output)

**Event stream (bottom-right):**
- `EventSource` connected to `/pipelines/:id/events`
- Events append to Zustand store, rendered as scrollable list
- Auto-scroll with pause toggle
- Color coded: green=completed, red=failed, blue=started, yellow=retrying
- Click event → expand details

**Human gate bar (bottom):**
- Shows when `InterviewStarted` event received
- Renders question text + choice buttons
- `POST /pipelines/:id/questions/:qid/answer` on click
- Auto-hides when answered

#### 2. Pipeline Detail (`/pipelines/:id`)

- Full graph SVG with execution state
- Context values table (`GET /context`)
- Checkpoint state (`GET /checkpoint`)
- Node outcomes with durations + output
- Complete event log

#### 3. History (`/history`)

- All completed pipelines
- Filter by status (completed/failed/cancelled)
- Stats: success rate, avg duration, total runs

#### 4. Submit (`/submit`)

- DOT source textarea (with syntax highlighting if possible)
- Or file path input
- Project root path
- Config overrides (model, thresholds)
- `POST /pipelines` on submit → redirect to dashboard

### Client Implementation Notes

**SSE hook:**
```typescript
const useSSE = (pipelineId: string) => {
  useEffect(() => {
    const source = new EventSource(`/pipelines/${pipelineId}/events`)
    source.addEventListener("StageStarted", (e) => {
      store.addEvent(JSON.parse(e.data))
    })
    source.addEventListener("StageCompleted", (e) => {
      store.addEvent(JSON.parse(e.data))
      refetchGraph() // re-render SVG with updated state
    })
    // ... other event types
    return () => source.close()
  }, [pipelineId])
}
```

**Graph rendering hook:**
```typescript
const useDotGraph = (pipelineId: string) => {
  const [svg, setSvg] = useState("")
  const graphviz = useRef<Graphviz>()

  useEffect(() => {
    Graphviz.load().then(g => graphviz.current = g)
  }, [])

  const render = async () => {
    const { dot, executionState } = await fetch(`/pipelines/${pipelineId}/graph`).then(r => r.json())
    const styledDot = applyExecutionStyles(dot, executionState)
    const svgStr = graphviz.current.dot(styledDot)
    setSvg(svgStr)
  }

  return { svg, render }
}
```

**State store (Zustand):**
```typescript
interface MonitorStore {
  pipelines: Pipeline[]
  selectedId: string
  events: Map<string, PipelineEvent[]>
  questions: Map<string, Question[]>
  addEvent: (pipelineId: string, event: PipelineEvent) => void
  selectPipeline: (id: string) => void
}
```

### Design

- Dark theme: `#0d1117` background, `#161b22` cards, `#30363d` borders
- Monospace: code, context values, DOT source
- Sans-serif: UI chrome, labels, buttons
- Graph node colors via CSS on SVG elements
- Status colors: `#3fb950` green, `#f85149` red, `#58a6ff` blue, `#d29922` yellow, `#8b949e` gray

## Event Types (Attractor §9.6)

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

1. **Server** — Hono HTTP server in `src/server/`, all REST + SSE endpoints, Interviewer integration
2. **`arc serve` command** — add to CLI
3. **Client scaffold** — Vite + React + Tailwind + shadcn/ui + WASM Graphviz
4. **Dashboard** — pipeline list + DOT→SVG graph + SSE events + human gates
5. **Detail view** — context, checkpoint, outcomes
6. **History + Submit** — browse past runs, start new ones
7. **Polish** — animations, responsive, error handling

## Verification

1. Server: `POST /pipelines` starts a mock pipeline, SSE streams events, `GET /graph` returns DOT + state
2. Client: graph renders with correct node colors, events stream in real-time, human gate buttons work
3. End-to-end: start pipeline from Submit page, watch it execute on Dashboard, answer human gate, see it complete
