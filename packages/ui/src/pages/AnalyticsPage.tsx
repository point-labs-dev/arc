import { useMemo } from "react"

import type { MonitorState } from "../types"

interface AnalyticsPageProps {
  readonly monitor: MonitorState
}

export const AnalyticsPage = ({ monitor }: AnalyticsPageProps) => {
  const metrics = useMemo(() => {
    const sessions = monitor.sessions
    const totalCost = sessions.reduce((sum, session) => sum + session.costUsd, 0)
    const passCount = sessions.filter((session) => session.status === "done").length
    const failCount = sessions.filter((session) => session.status === "failed").length

    const byProject = sessions.reduce<Record<string, number>>((accumulator, session) => {
      accumulator[session.project] = (accumulator[session.project] ?? 0) + session.costUsd
      return accumulator
    }, {})

    return {
      totalCost,
      passRate: sessions.length === 0 ? 0 : passCount / sessions.length,
      failCount,
      byProject,
    }
  }, [monitor.sessions])

  const maxProjectCost = Math.max(1, ...Object.values(metrics.byProject))

  return (
    <section className="stack-layout">
      <div className="panel analytics-cards">
        <article>
          <h3>Total Cost</h3>
          <p>${metrics.totalCost.toFixed(2)}</p>
        </article>
        <article>
          <h3>Success Rate</h3>
          <p>{(metrics.passRate * 100).toFixed(0)}%</p>
        </article>
        <article>
          <h3>Failures</h3>
          <p>{metrics.failCount}</p>
        </article>
      </div>

      <section className="panel chart-panel">
        <h3>Cost by Project</h3>
        {Object.entries(metrics.byProject).map(([project, cost]) => (
          <div key={project} className="bar-row">
            <span>{project}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(cost / maxProjectCost) * 100}%` }} />
            </div>
            <span>${cost.toFixed(2)}</span>
          </div>
        ))}
      </section>
    </section>
  )
}
