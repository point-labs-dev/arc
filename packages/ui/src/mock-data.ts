import type { MonitorAlert, MonitorSession, SessionEvent } from "./types"

export const MOCK_SESSIONS: MonitorSession[] = [
  {
    id: "s-101",
    taskName: "Convergence loop MVP",
    project: "arc",
    model: "claude-sonnet-4",
    status: "active",
    startedAt: "2026-02-22T20:55:00.000Z",
    durationSec: 534,
    costUsd: 0.42,
    tokenIn: 18420,
    tokenOut: 4860,
    contextPercent: 71,
    filesChanged: ["packages/cli/src/convergence.ts", "packages/cli/src/verification.ts"],
    retries: 1,
  },
  {
    id: "s-099",
    taskName: "Pi backend hardening",
    project: "arc",
    model: "claude-sonnet-4",
    status: "done",
    startedAt: "2026-02-22T18:10:00.000Z",
    endedAt: "2026-02-22T18:26:00.000Z",
    durationSec: 960,
    costUsd: 0.27,
    tokenIn: 9640,
    tokenOut: 2190,
    contextPercent: 44,
    filesChanged: ["packages/pi-backend/src/index.ts", "packages/pi-backend/src/index.test.ts"],
    retries: 0,
  },
  {
    id: "s-097",
    taskName: "Holdout scenario parser",
    project: "arc",
    model: "claude-sonnet-4",
    status: "failed",
    startedAt: "2026-02-22T16:20:00.000Z",
    endedAt: "2026-02-22T16:28:00.000Z",
    durationSec: 480,
    costUsd: 0.16,
    tokenIn: 6820,
    tokenOut: 1380,
    contextPercent: 58,
    filesChanged: ["packages/engine/src/verification/scenarios.ts"],
    retries: 2,
  },
]

export const MOCK_EVENTS: SessionEvent[] = [
  {
    id: "e1",
    sessionId: "s-101",
    timestamp: "2026-02-22T20:55:14.000Z",
    kind: "file_read",
    label: "Read SPEC.md",
    path: "SPEC.md",
  },
  {
    id: "e2",
    sessionId: "s-101",
    timestamp: "2026-02-22T20:56:01.000Z",
    kind: "file_edit",
    label: "Edit convergence loop",
    path: "packages/cli/src/convergence.ts",
    diff: "- const status = 'pending'\n+ const status = verification.passed ? 'success' : 'fail'",
  },
  {
    id: "e3",
    sessionId: "s-101",
    timestamp: "2026-02-22T20:56:43.000Z",
    kind: "bash",
    label: "Run unit tests",
    command: "npm run test --workspace @point-labs/arc-cli",
    output: "12 passed",
    passed: true,
  },
  {
    id: "e4",
    sessionId: "s-101",
    timestamp: "2026-02-22T20:57:20.000Z",
    kind: "verification",
    label: "Verification completed",
    passed: false,
    details: "Holdout failed: auth-flow",
  },
  {
    id: "e5",
    sessionId: "s-101",
    timestamp: "2026-02-22T20:57:30.000Z",
    kind: "retry",
    label: "Retrying attempt #2",
    details: "Satisfaction score below threshold",
  },
  {
    id: "e6",
    sessionId: "s-099",
    timestamp: "2026-02-22T18:22:10.000Z",
    kind: "commit",
    label: "Commit created",
    details: "feat(pi-backend): implement fresh-session rpc backend",
  },
  {
    id: "e7",
    sessionId: "s-097",
    timestamp: "2026-02-22T16:27:02.000Z",
    kind: "alert",
    label: "Sensitive file access detected",
    path: ".env",
    alertLevel: "warn",
    details: "Session attempted to read .env while debugging tests",
  },
  {
    id: "e8",
    sessionId: "s-097",
    timestamp: "2026-02-22T16:27:21.000Z",
    kind: "learning",
    label: "Learning persisted",
    details: "Need to parse numbered steps and bullet steps in scenario markdown",
  },
]

export const MOCK_ALERTS: MonitorAlert[] = [
  {
    id: "a1",
    sessionId: "s-097",
    message: ".env accessed by session s-097",
    level: "warn",
    timestamp: "2026-02-22T16:27:02.000Z",
  },
  {
    id: "a2",
    sessionId: "s-101",
    message: "Verification failure streak: 2 attempts",
    level: "error",
    timestamp: "2026-02-22T20:57:35.000Z",
  },
]

export const DEFAULT_MERMAID = `graph TD
  SPEC[Read SPEC.md]
  ATTEMPT[Fresh Pi Session]
  VERIFY[Standard + Holdout + Satisfaction]
  PASS{Pass?}
  LEARN[Persist Learnings]
  RETRY[Spawn New Session]
  COMMIT[Commit]

  SPEC --> ATTEMPT
  ATTEMPT --> VERIFY
  VERIFY --> PASS
  PASS -->|yes| COMMIT
  PASS -->|no| LEARN --> RETRY --> ATTEMPT
`

export const DEFAULT_DOT = `digraph Arc {
  SPEC -> ATTEMPT;
  ATTEMPT -> VERIFY;
  VERIFY -> PASS;
  PASS -> COMMIT [label="yes"];
  PASS -> LEARN [label="no"];
  LEARN -> RETRY;
  RETRY -> ATTEMPT;
}`
