import mermaid from "mermaid"
import { useEffect, useMemo, useState } from "react"

interface MermaidDiagramProps {
  readonly source: string
}

let initialized = false

export const MermaidDiagram = ({ source }: MermaidDiagramProps) => {
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const renderId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 9)}`, [])

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
      })
      initialized = true
    }

    let cancelled = false

    const render = async () => {
      try {
        const rendered = await mermaid.render(renderId, source)
        if (!cancelled) {
          setSvg(rendered.svg)
          setError(null)
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("")
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Failed to render Mermaid diagram",
          )
        }
      }
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [renderId, source])

  if (error !== null) {
    return <pre className="diagram-error">{error}</pre>
  }

  return <div className="diagram-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
}
