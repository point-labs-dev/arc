import { NavLink, Navigate, Route, Routes } from "react-router-dom"

import { useArcMonitor } from "./hooks/useArcMonitor"
import { AnalyticsPage } from "./pages/AnalyticsPage"
import { ArchitecturePage } from "./pages/ArchitecturePage"
import { LiveDashboardPage } from "./pages/LiveDashboardPage"
import { SessionDetailPage } from "./pages/SessionDetailPage"
import { SessionExplorerPage } from "./pages/SessionExplorerPage"

export const App = () => {
  const monitor = useArcMonitor()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="kicker">Arc Monitor</p>
          <h1>Software Factory Observability</h1>
        </div>
        <div className="connection-pill">
          <span className={`dot ${monitor.websocketConnected ? "online" : "offline"}`} />
          {monitor.websocketConnected ? "Live stream connected" : "Replay mode"}
        </div>
      </header>

      <nav className="nav-tabs">
        <NavLink className="tab-link" to="/" end>
          Live
        </NavLink>
        <NavLink className="tab-link" to="/sessions">
          Sessions
        </NavLink>
        <NavLink className="tab-link" to="/analytics">
          Analytics
        </NavLink>
        <NavLink className="tab-link" to="/architecture">
          Architecture
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<LiveDashboardPage monitor={monitor} />} />
        <Route path="/sessions" element={<SessionExplorerPage monitor={monitor} />} />
        <Route path="/sessions/:id" element={<SessionDetailPage monitor={monitor} />} />
        <Route path="/analytics" element={<AnalyticsPage monitor={monitor} />} />
        <Route path="/architecture" element={<ArchitecturePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
