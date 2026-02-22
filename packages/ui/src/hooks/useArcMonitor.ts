import { useEffect, useMemo, useState } from "react"

import { MOCK_ALERTS, MOCK_EVENTS, MOCK_SESSIONS } from "../mock-data"
import type { MonitorAlert, MonitorSession, MonitorState, SessionEvent, SessionStatus } from "../types"

const DEFAULT_WS_URL = "ws://127.0.0.1:4174/ws"

export const useArcMonitor = (): MonitorState => {
  const [sessions, setSessions] = useState<MonitorSession[]>(MOCK_SESSIONS)
  const [events, setEvents] = useState<SessionEvent[]>(MOCK_EVENTS)
  const [alerts, setAlerts] = useState<MonitorAlert[]>(MOCK_ALERTS)
  const [selectedSessionId, setSelectedSessionId] = useState<string>(MOCK_SESSIONS[0]?.id ?? "")
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [websocketConnected, setWebsocketConnected] = useState(false)

  useEffect(() => {
    const wsUrl = readWebsocketUrl()
    let socket: WebSocket | undefined

    try {
      socket = new WebSocket(wsUrl)
    } catch {
      setWebsocketConnected(false)
      return
    }

    socket.addEventListener("open", () => {
      setWebsocketConnected(true)
    })

    socket.addEventListener("close", () => {
      setWebsocketConnected(false)
    })

    socket.addEventListener("error", () => {
      setWebsocketConnected(false)
    })

    socket.addEventListener("message", (message) => {
      const event = parseIncomingEvent(message.data)
      if (event === undefined) {
        return
      }

      const normalized = mapArcEvent(event)
      if (normalized === undefined) {
        return
      }

      setEvents((current) => [...current, normalized.event])
      setSessions((current) => upsertSession(current, normalized.sessionUpdate))

      const alert = normalized.alert
      if (alert !== undefined) {
        setAlerts((current) => [...current, alert])
      }
    })

    return () => {
      socket?.close()
    }
  }, [])

  useEffect(() => {
    if (selectedSessionId.length > 0) {
      return
    }

    const first = sessions[0]
    if (first !== undefined) {
      setSelectedSessionId(first.id)
    }
  }, [selectedSessionId, sessions])

  return useMemo(
    () => ({
      sessions,
      events,
      alerts,
      selectedSessionId,
      selectedEventId,
      websocketConnected,
      setSelectedSessionId,
      setSelectedEventId,
    }),
    [alerts, events, selectedEventId, selectedSessionId, sessions, websocketConnected],
  )
}

interface IncomingArcEvent {
  readonly type: string
  readonly attempt?: number
  readonly timestamp?: string
  readonly [key: string]: unknown
}

interface ArcMapping {
  readonly event: SessionEvent
  readonly sessionUpdate: MonitorSession
  readonly alert?: MonitorAlert
}

const readWebsocketUrl = (): string => {
  const configured = import.meta.env.VITE_ARC_WS_URL
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return DEFAULT_WS_URL
  }
  return configured
}

const parseIncomingEvent = (raw: unknown): IncomingArcEvent | undefined => {
  if (typeof raw !== "string") {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return undefined
    }

    if (!("type" in parsed) || typeof parsed.type !== "string") {
      return undefined
    }

    return parsed as IncomingArcEvent
  } catch {
    return undefined
  }
}

const mapArcEvent = (event: IncomingArcEvent): ArcMapping | undefined => {
  const attempt = Math.max(1, Math.floor(readNumber(event.attempt, 1)))
  const timestamp = readString(event.timestamp) ?? new Date().toISOString()
  const sessionId = `attempt-${String(attempt).padStart(3, "0")}`

  const sessionUpdate: MonitorSession = {
    id: sessionId,
    taskName: "Convergence attempt",
    project: "arc",
    model: "claude-sonnet-4",
    status: statusForEvent(event.type),
    startedAt: timestamp,
    durationSec: 0,
    costUsd: 0,
    tokenIn: 0,
    tokenOut: 0,
    contextPercent: 0,
    filesChanged: [],
    retries: event.type === "attempt_start" ? 0 : event.type === "learning_persisted" ? 1 : 0,
  }

  const mapped: SessionEvent = {
    id: `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp,
    kind: kindForEvent(event.type),
    label: labelForEvent(event),
    details: readString(event.summary) ?? readString(event.message) ?? readString(event.path),
  }

  if (event.type === "alert") {
    const alert: MonitorAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      message: readString(event.message) ?? "Arc alert",
      level: readAlertLevel(event.level),
      timestamp,
    }

    return {
      event: mapped,
      sessionUpdate,
      alert,
    }
  }

  return {
    event: mapped,
    sessionUpdate,
  }
}

const upsertSession = (
  sessions: readonly MonitorSession[],
  incoming: MonitorSession,
): MonitorSession[] => {
  const existing = sessions.find((session) => session.id === incoming.id)
  if (existing === undefined) {
    return [incoming, ...sessions]
  }

  return sessions.map((session) => (session.id === incoming.id ? mergeSession(session, incoming) : session))
}

const mergeSession = (current: MonitorSession, incoming: MonitorSession): MonitorSession => ({
  ...current,
  ...incoming,
  taskName: current.taskName,
  project: current.project,
  model: current.model,
  startedAt: current.startedAt,
})

const statusForEvent = (type: string): SessionStatus => {
  if (type === "attempt_start") {
    return "active"
  }
  if (type === "commit") {
    return "done"
  }
  if (type === "alert") {
    return "failed"
  }
  if (type === "learning_persisted") {
    return "failed"
  }
  return "active"
}

const kindForEvent = (type: string): SessionEvent["kind"] => {
  if (type === "verification_end") {
    return "verification"
  }
  if (type === "commit") {
    return "commit"
  }
  if (type === "alert") {
    return "alert"
  }
  if (type === "learning_persisted") {
    return "learning"
  }
  if (type === "attempt_start" || type === "attempt_end") {
    return "text"
  }
  return "tool_call"
}

const labelForEvent = (event: IncomingArcEvent): string => {
  if (event.type === "attempt_start") {
    return "Attempt started"
  }
  if (event.type === "attempt_end") {
    return "Attempt finished"
  }
  if (event.type === "verification_end") {
    return readBoolean(event.passed) ? "Verification passed" : "Verification failed"
  }
  if (event.type === "commit") {
    return `Commit ${readString(event.hash) ?? "created"}`
  }
  if (event.type === "learning_persisted") {
    return "Learning persisted"
  }
  if (event.type === "alert") {
    return readString(event.message) ?? "Alert"
  }
  return event.type
}

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

const readNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback
  }
  return value
}

const readBoolean = (value: unknown): boolean => value === true

const readAlertLevel = (value: unknown): MonitorAlert["level"] =>
  value === "error" ? "error" : "warn"
