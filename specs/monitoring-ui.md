# Arc Monitoring UI — Spec

## Overview

A web-based monitoring dashboard for Arc coding sessions. Two modes: **Live** (real-time while agents execute) and **Replay** (post-hoc inspection of past sessions). Combines the best of claude-devtools (deep trace reconstruction) and Sidecar (live monitoring) with Arc-native data.

## Tech Stack

- **Framework:** Vite + React 19 + TypeScript
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **State:** Zustand (lightweight, good for streaming data)
- **Data:** SQLite via better-sqlite3 (session persistence)
- **Live transport:** WebSocket (Arc → UI event stream)
- **Diff rendering:** react-diff-viewer or diff2html
- **Charts:** recharts (token/cost trends)
- **Monorepo location:** `packages/ui/` within arc project

## Screens

### 1. Live Dashboard (`/`)

The main view when agents are running. Split layout:

```
┌─────────────────────────────────────────────────────────┐
│ Arc Monitor                              ● 3 sessions   │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Sessions    │  Event Feed                              │
│  ┌────────┐  │  ┌────────────────────────────────────┐  │
│  │ Task 1 │◄─│  │ 12:04:01 Read src/auth.ts          │  │
│  │ ●active│  │  │ 12:04:03 Edit src/auth.ts L42-58   │  │
│  ├────────┤  │  │ 12:04:05 Run npm test              │  │
│  │ Task 2 │  │  │ 12:04:12 ✓ Tests passed (3/3)     │  │
│  │ ●active│  │  │ 12:04:13 Read src/routes.ts        │  │
│  ├────────┤  │  └────────────────────────────────────┘  │
│  │ Task 3 │  │                                          │
│  │ ○queued│  │  ┌────────────────────────────────────┐  │
│  └────────┘  │  │ Diff: src/auth.ts                  │  │
│              │  │ - const token = req.headers.auth    │  │
│  Context     │  │ + const token = req.headers.get(    │  │
│  ████████░░  │  │ +   'authorization'                 │  │
│  72% used    │  │ + )?.replace('Bearer ', '')         │  │
│              │  └────────────────────────────────────┘  │
│  Tokens      │                                          │
│  In:  12.4k  │  Stats                                   │
│  Out:  3.2k  │  Duration: 2m 14s │ Cost: $0.08        │
│  Cost: $0.08 │  Files: 3 changed │ Tools: 12 calls    │
│              │                                          │
├──────────────┴──────────────────────────────────────────┤
│ ⚠ Alert: .env accessed by Session 2              12:03 │
└─────────────────────────────────────────────────────────┘
```

**Left sidebar — Session list:**
- All active Pi sessions with status (active/queued/done/failed)
- Click to focus event feed on that session
- Context window usage bar (visual, like a progress bar with segments)
- Running token count (input/output) and dollar cost
- Task name from backlog

**Main area — Event feed:**
- Chronological stream of events from the focused session
- Event types with icons:
  - 📖 File read (path, line range)
  - ✏️ File edit (path, inline diff preview — expandable to full diff)
  - 🔧 Tool call (tool name, args summary, result summary — expandable)
  - 💬 Model response (thinking/reasoning, expandable)
  - ▶️ Bash command (command, exit code, output preview)
  - ✅ Verification pass / ❌ Verification fail
  - 🔄 Retry attempt
  - 📝 Learning captured
- Click any event to expand full detail
- Auto-scroll with "pause" button to review history

**Diff panel:**
- Shows the most recent file edit as an inline diff
- Side-by-side or unified toggle
- Syntax highlighted
- Clicking a file edit event in the feed replaces this panel

**Bottom bar — Alerts:**
- Sensitive file access (.env, secrets, credentials)
- Token spike (single tool call > configurable threshold)
- Cost threshold exceeded
- Verification failure streak
- Dismissable, with history

### 2. Session Explorer (`/sessions`)

Browse and search past sessions.

```
┌─────────────────────────────────────────────────────────┐
│ Session Explorer          🔍 Search sessions...         │
├─────────────────────────────────────────────────────────┤
│ Filters: [All Projects ▼] [All Outcomes ▼] [This Week] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Today                                                   │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ✅ Add /api/users endpoint     12m  $0.34  4 files  │ │
│ │    trading-agent • Task #12 • Sonnet 4              │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ ❌ Fix auth middleware          8m  $0.21  2 files  │ │
│ │    trading-agent • Task #13 • Sonnet 4 • 2 retries  │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ ✅ Update schema migrations     3m  $0.08  1 file   │ │
│ │    point-labs-site • Task #5 • Haiku                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Yesterday                                               │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ✅ Implement WebSocket server  22m  $0.89  8 files  │ │
│ │    arc • Task #7 • Sonnet 4                         │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Summary: 47 sessions this week │ $12.34 total │ 82% ✅  │
└─────────────────────────────────────────────────────────┘
```

**Session list:**
- Grouped by date
- Each card: outcome icon, task name, duration, cost, files changed count
- Subtitle: project, backlog task ref, model used, retry count
- Click to open session detail view

**Filters:**
- Project (dropdown)
- Outcome (pass/fail/all)
- Date range
- Model used
- Search (full text across task names, file paths, tool calls)

**Summary bar:**
- Total sessions, total cost, success rate for filtered period

### 3. Session Detail (`/sessions/:id`)

Full trace reconstruction of a single session.

```
┌─────────────────────────────────────────────────────────┐
│ ← Back    Add /api/users endpoint    ✅ Passed          │
│ trading-agent • Task #12 • Sonnet 4 • 12m • $0.34      │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Timeline    │  Detail Panel                            │
│              │                                          │
│  12:00:01    │  ┌────────────────────────────────────┐  │
│  ● Start     │  │ Task Spec                          │  │
│  │           │  │ Add a REST endpoint for user CRUD  │  │
│  12:00:03    │  │ at /api/users with validation...   │  │
│  ● Read ×4   │  └────────────────────────────────────┘  │
│  │           │                                          │
│  12:01:15    │  ┌────────────────────────────────────┐  │
│  ● Edit ×2   │  │ Diff: src/routes/users.ts (new)   │  │
│  │           │  │ + import { Router } from 'express' │  │
│  12:02:30    │  │ + import { validateUser } from ... │  │
│  ● Bash      │  │ + const router = Router()          │  │
│  │           │  │ + ...                              │  │
│  12:03:45    │  └────────────────────────────────────┘  │
│  ● Test ✅   │                                          │
│  │           │  ┌────────────────────────────────────┐  │
│  12:04:01    │  │ Token Usage                        │  │
│  ● Commit    │  │ ████████████░░░  72% context       │  │
│  │           │  │ In: 12.4k  Out: 3.2k  Cache: 8.1k │  │
│  12:04:03    │  │ Cost: $0.34                        │  │
│  ● Learning  │  └────────────────────────────────────┘  │
│              │                                          │
│  12:04:05    │  ┌────────────────────────────────────┐  │
│  ● End ✅    │  │ Learning                           │  │
│              │  │ Express route validation works best │  │
│              │  │ with zod schemas inline rather than │  │
│              │  │ separate validation files...        │  │
│              │  └────────────────────────────────────┘  │
├──────────────┴──────────────────────────────────────────┤
│ Files Changed: src/routes/users.ts (new) │ src/app.ts  │
│               tests/users.test.ts (new)  │ schema.ts   │
└─────────────────────────────────────────────────────────┘
```

**Left — Timeline:**
- Vertical timeline of all events
- Color-coded by type (read=blue, edit=yellow, bash=green, test=red/green)
- Click any event to show detail in right panel
- Collapsible groups (e.g., "Read ×4" expands to show all 4 reads)

**Right — Detail panel:**
- Shows expanded content of selected timeline event
- For edits: full syntax-highlighted diff (unified or side-by-side)
- For bash: command, output, exit code
- For tool calls: args + result as formatted JSON
- For thinking: model's reasoning text
- Task spec always accessible at top

**Bottom — Files changed:**
- List of all files modified in this session
- Click to see cumulative diff for that file

**Header:**
- Task name, outcome, project, model, duration, cost
- Link back to backlog task
- Retry indicator if applicable

### 4. Analytics (`/analytics`)

Trends and patterns across sessions.

- **Cost over time** — daily/weekly spend by project
- **Success rate** — pass/fail trend, by model, by project
- **Token efficiency** — tokens per task trending down = getting better
- **Common failures** — what verification steps fail most
- **Model comparison** — cost/speed/success by model
- **Learning patterns** — recurring insights

## API / Data Layer

### WebSocket Events (Live)

Arc pushes events over WebSocket as sessions execute:

```typescript
type ArcEvent = {
  sessionId: string;
  taskId: string;
  project: string;
  timestamp: number;
} & (
  | { type: 'session_start'; taskSpec: string; model: string }
  | { type: 'file_read'; path: string; lines?: [number, number] }
  | { type: 'file_edit'; path: string; diff: string; linesChanged: number }
  | { type: 'tool_call'; tool: string; args: Record<string, any>; result: any; tokensUsed: number }
  | { type: 'bash'; command: string; exitCode: number; output: string }
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'token_update'; input: number; output: number; cache: number; contextPercent: number }
  | { type: 'verification'; command: string; passed: boolean; output: string }
  | { type: 'retry'; attempt: number; reason: string }
  | { type: 'learning'; insight: string }
  | { type: 'commit'; hash: string; message: string; filesChanged: string[] }
  | { type: 'session_end'; success: boolean; duration: number; totalCost: number }
  | { type: 'alert'; level: 'warn' | 'error'; message: string; details?: any }
);
```

### REST API (Replay)

```
GET /api/sessions                    — list sessions (with filters)
GET /api/sessions/:id                — session metadata
GET /api/sessions/:id/events         — full event trace
GET /api/sessions/:id/diffs          — all file diffs
GET /api/sessions/:id/cost           — token/cost breakdown
GET /api/analytics/cost?range=7d     — cost trends
GET /api/analytics/success?range=30d — success rate trends
```

### Storage

SQLite tables:
- `sessions` — id, project, taskId, taskSpec, model, startedAt, endedAt, success, totalTokens, totalCost
- `events` — id, sessionId, type, timestamp, data (JSON)
- `alerts` — id, sessionId, level, message, dismissed

## Design

- **Dark theme** (default, matches terminal aesthetic)
- **Monospace** for code/diffs, sans-serif for UI
- **Color palette:** Dark grays (#0d1117, #161b22) with accent colors per event type
- **Responsive:** Works on laptop browser and can be pushed to Canvas
- **Animations:** Smooth event feed scroll, diff expand/collapse transitions

## Build Plan

1. **Scaffold** — Vite + React + Tailwind + shadcn/ui
2. **Mock data layer** — Generate fake sessions/events for UI development
3. **Live Dashboard** — Event feed, session sidebar, diff panel
4. **Session Explorer** — List, search, filters
5. **Session Detail** — Timeline + detail panel + file diffs
6. **WebSocket integration** — Connect to real Arc event stream
7. **SQLite persistence** — Store and query real sessions
8. **Analytics** — Charts and trends
9. **Alerts** — Real-time alert system
10. **Polish** — Animations, responsive, edge cases
