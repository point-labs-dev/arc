export type SessionStatus = "active" | "queued" | "done" | "failed"
export type EventKind =
  | "file_read"
  | "file_edit"
  | "tool_call"
  | "bash"
  | "verification"
  | "retry"
  | "learning"
  | "commit"
  | "alert"
  | "text"

export interface MonitorSession {
  readonly id: string
  readonly taskName: string
  readonly project: string
  readonly model: string
  readonly status: SessionStatus
  readonly startedAt: string
  readonly endedAt?: string
  readonly durationSec: number
  readonly costUsd: number
  readonly tokenIn: number
  readonly tokenOut: number
  readonly contextPercent: number
  readonly filesChanged: readonly string[]
  readonly retries: number
}

export interface SessionEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestamp: string
  readonly kind: EventKind
  readonly label: string
  readonly path?: string
  readonly diff?: string
  readonly command?: string
  readonly output?: string
  readonly passed?: boolean
  readonly alertLevel?: "warn" | "error"
  readonly details?: string
}

export interface MonitorAlert {
  readonly id: string
  readonly sessionId: string
  readonly message: string
  readonly level: "warn" | "error"
  readonly timestamp: string
}

export interface MonitorState {
  readonly sessions: readonly MonitorSession[]
  readonly events: readonly SessionEvent[]
  readonly alerts: readonly MonitorAlert[]
  readonly selectedSessionId: string
  readonly selectedEventId: string | null
  readonly websocketConnected: boolean
  setSelectedSessionId(sessionId: string): void
  setSelectedEventId(eventId: string | null): void
}
