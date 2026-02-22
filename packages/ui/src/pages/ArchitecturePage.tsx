import { useMemo, useState } from "react"

import { DEFAULT_DOT, DEFAULT_MERMAID } from "../mock-data"
import { MermaidDiagram } from "../components/MermaidDiagram"
import { dotToMermaid } from "../lib/dot"

export const ArchitecturePage = () => {
  const [dotSource, setDotSource] = useState(DEFAULT_DOT)
  const [mermaidSource, setMermaidSource] = useState(DEFAULT_MERMAID)
  const [mode, setMode] = useState<"mermaid" | "dot">("mermaid")

  const renderedSource = useMemo(
    () => (mode === "mermaid" ? mermaidSource : dotToMermaid(dotSource)),
    [dotSource, mermaidSource, mode],
  )

  return (
    <section className="architecture-layout">
      <section className="panel editor-panel">
        <header className="panel-title">Architecture Source</header>
        <div className="toggle-row">
          <button
            className={`segmented ${mode === "mermaid" ? "is-active" : ""}`}
            onClick={() => setMode("mermaid")}
            type="button"
          >
            Mermaid
          </button>
          <button
            className={`segmented ${mode === "dot" ? "is-active" : ""}`}
            onClick={() => setMode("dot")}
            type="button"
          >
            DOT
          </button>
        </div>

        {mode === "mermaid" ? (
          <textarea
            className="diagram-input"
            value={mermaidSource}
            onChange={(event) => setMermaidSource(event.target.value)}
          />
        ) : (
          <textarea
            className="diagram-input"
            value={dotSource}
            onChange={(event) => setDotSource(event.target.value)}
          />
        )}
      </section>

      <section className="panel render-panel">
        <header className="panel-title">Rendered Workflow</header>
        <MermaidDiagram source={renderedSource} />
      </section>
    </section>
  )
}
