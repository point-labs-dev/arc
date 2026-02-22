import { useMemo } from "react"

import type { MonitorState, SessionEvent } from "../types"

interface LiveDashboardPageProps {
  readonly monitor: MonitorState
}

export const LiveDashboardPage = ({ monitor }: LiveDashboardPageProps) => {
  const selectedSession =
    monitor.sessions.find((session) => session.id === monitor.selectedSessionId) ?? monitor.sessions[0]

  const sessionEvents = useMemo(
    () =>
      monitor.events
        .filter((event) => event.sessionId === selectedSession?.id)
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    [monitor.events, selectedSession?.id],
  )

  const selectedEvent =
    sessionEvents.find((event) => event.id === monitor.selectedEventId) ?? sessionEvents[0] ?? null

  return (
    <section className="live-layout">
      <aside className="panel sidebar">
        <header className="panel-title">Sessions</header>
        <div className="session-list">
          {monitor.sessions.map((session) => (
            <button
              key={session.id}
              className={`session-card ${session.id === selectedSession?.id ? "is-selected" : ""}`}
              onClick={() => {
                monitor.setSelectedSessionId(session.id)
                monitor.setSelectedEventId(null)
              }}
              type="button"
            >
              <div className="session-head">
                <span>{session.taskName}</span>
                <span className={`badge status-${session.status}`}>{session.status}</span>
              </div>
              <div className="session-meta">{session.project} • {session.model}</div>
              <div className="progress-shell">
                <div className="progress-fill" style={{ width: `${session.contextPercent}%` }} />
              </div>
              <div className="session-stats">
                <span>{session.contextPercent}% context</span>
                <span>${session.costUsd.toFixed(2)}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel feed-panel">
        <header className="panel-title">Event Feed</header>
        <div className="event-list">
          {sessionEvents.map((event) => (
            <button
              key={event.id}
              className={`event-row ${event.id === selectedEvent?.id ? "is-selected" : ""}`}
              onClick={() => monitor.setSelectedEventId(event.id)}
              type="button"
            >
              <time>{toClock(event.timestamp)}</time>
              <span className={`event-kind kind-${event.kind}`}>{labelForKind(event.kind)}</span>
              <span className="event-label">{event.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel detail-panel">
        <header className="panel-title">Detail</header>
        {selectedEvent === null ? (
          <p className="muted">Select an event to inspect details.</p>
        ) : (
          <EventDetail event={selectedEvent} />
        )}

        {selectedSession !== undefined ? (
          <dl className="stat-grid">
            <div>
              <dt>Duration</dt>
              <dd>{Math.floor(selectedSession.durationSec / 60)}m {selectedSession.durationSec % 60}s</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>{selectedSession.tokenIn.toLocaleString()} in / {selectedSession.tokenOut.toLocaleString()} out</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>{selectedSession.filesChanged.length}</dd>
            </div>
            <div>
              <dt>Retries</dt>
              <dd>{selectedSession.retries}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="panel alert-panel">
        <header className="panel-title">Alerts</header>
        <div className="alert-list">
          {monitor.alerts.slice(-4).reverse().map((alert) => (
            <article key={alert.id} className={`alert-row alert-${alert.level}`}>
              <span>{alert.message}</span>
              <time>{toClock(alert.timestamp)}</time>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

const EventDetail = ({ event }: { event: SessionEvent }) => (
  <article className="event-detail">
    <h3>{event.label}</h3>
    <p className="muted">{event.path ?? event.command ?? "No path"}</p>
    {event.diff !== undefined ? <pre className="code-block">{event.diff}</pre> : null}
    {event.output !== undefined ? <pre className="code-block">{event.output}</pre> : null}
    {event.details !== undefined ? <p>{event.details}</p> : null}
  </article>
)

const labelForKind = (kind: SessionEvent["kind"]): string => {
  const labels: Record<SessionEvent["kind"], string> = {
    file_read: "Read",
    file_edit: "Edit",
    tool_call: "Tool",
    bash: "Bash",
    verification: "Verify",
    retry: "Retry",
    learning: "Learning",
    commit: "Commit",
    alert: "Alert",
    text: "Text",
  }

  return labels[kind]
}

const toClock = (isoTimestamp: string): string => {
  const date = new Date(isoTimestamp)
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}
