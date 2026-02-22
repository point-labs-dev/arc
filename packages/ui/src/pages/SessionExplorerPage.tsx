import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import type { MonitorState, SessionStatus } from "../types"

interface SessionExplorerPageProps {
  readonly monitor: MonitorState
}

export const SessionExplorerPage = ({ monitor }: SessionExplorerPageProps) => {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | SessionStatus>("all")

  const sessions = useMemo(
    () =>
      monitor.sessions.filter((session) => {
        if (statusFilter !== "all" && session.status !== statusFilter) {
          return false
        }

        if (query.trim().length === 0) {
          return true
        }

        const haystack = `${session.taskName} ${session.project} ${session.model}`.toLowerCase()
        return haystack.includes(query.trim().toLowerCase())
      }),
    [monitor.sessions, query, statusFilter],
  )

  const successRate =
    sessions.length === 0
      ? 0
      : sessions.filter((session) => session.status === "done").length / sessions.length

  return (
    <section className="stack-layout">
      <header className="panel filter-row">
        <input
          className="text-input"
          placeholder="Search sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="text-input"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "all" | SessionStatus)}
        >
          <option value="all">All outcomes</option>
          <option value="active">Active</option>
          <option value="done">Passed</option>
          <option value="failed">Failed</option>
          <option value="queued">Queued</option>
        </select>
        <div className="summary-pill">Success {(successRate * 100).toFixed(0)}%</div>
      </header>

      <section className="panel list-panel">
        {sessions.map((session) => (
          <Link key={session.id} className="session-line" to={`/sessions/${session.id}`}>
            <div>
              <h3>{session.taskName}</h3>
              <p>{session.project} • {session.model}</p>
            </div>
            <div className="session-line-meta">
              <span className={`badge status-${session.status}`}>{session.status}</span>
              <span>{Math.floor(session.durationSec / 60)}m</span>
              <span>${session.costUsd.toFixed(2)}</span>
              <span>{session.filesChanged.length} files</span>
            </div>
          </Link>
        ))}

        {sessions.length === 0 ? <p className="muted">No sessions match current filters.</p> : null}
      </section>
    </section>
  )
}
