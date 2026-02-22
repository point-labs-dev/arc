import { Link, useParams } from "react-router-dom"

import type { MonitorState } from "../types"

interface SessionDetailPageProps {
  readonly monitor: MonitorState
}

export const SessionDetailPage = ({ monitor }: SessionDetailPageProps) => {
  const { id } = useParams<{ id: string }>()
  const session = monitor.sessions.find((item) => item.id === id)

  if (session === undefined) {
    return (
      <section className="panel">
        <p className="muted">Session not found.</p>
        <Link className="inline-link" to="/sessions">
          Back to explorer
        </Link>
      </section>
    )
  }

  const events = monitor.events
    .filter((event) => event.sessionId === session.id)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))

  return (
    <section className="stack-layout">
      <header className="panel detail-header">
        <Link className="inline-link" to="/sessions">
          Back
        </Link>
        <div>
          <h2>{session.taskName}</h2>
          <p>{session.project} • {session.model}</p>
        </div>
        <span className={`badge status-${session.status}`}>{session.status}</span>
      </header>

      <section className="detail-columns">
        <aside className="panel timeline-panel">
          <h3>Timeline</h3>
          {events.map((event) => (
            <article key={event.id} className="timeline-row">
              <time>{toClock(event.timestamp)}</time>
              <div>
                <strong>{event.label}</strong>
                <p>{event.path ?? event.command ?? event.details ?? "No extra details"}</p>
              </div>
            </article>
          ))}
        </aside>

        <section className="panel detail-main">
          <h3>Session Stats</h3>
          <dl className="stat-grid">
            <div>
              <dt>Duration</dt>
              <dd>{Math.floor(session.durationSec / 60)}m {session.durationSec % 60}s</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>${session.costUsd.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>{session.tokenIn.toLocaleString()} / {session.tokenOut.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Retries</dt>
              <dd>{session.retries}</dd>
            </div>
          </dl>

          <h3>Files Changed</h3>
          <ul className="plain-list">
            {session.filesChanged.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </section>
      </section>
    </section>
  )
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
