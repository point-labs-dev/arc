export const dotToMermaid = (dotSource: string): string => {
  const normalized = dotSource.replaceAll("\r\n", "\n")
  const edges = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("->"))
    .map((line) => line.replace(/;$/, ""))

  if (edges.length === 0) {
    return "graph TD\n  A[No edges detected]"
  }

  const mermaidEdges = edges.map((edge) => {
    const labelMatch = edge.match(/\[label\s*=\s*"([^"]+)"\]/i)
    const cleaned = edge.replace(/\[.*\]/, "").trim()
    const parts = cleaned.split("->").map((part) => sanitizeNode(part.trim()))
    if (parts.length < 2) {
      return ""
    }

    const from = parts[0]
    const to = parts[1]
    if (labelMatch === null) {
      return `  ${from} --> ${to}`
    }

    return `  ${from} -- ${labelMatch[1]} --> ${to}`
  })

  const body = mermaidEdges.filter((line) => line.length > 0).join("\n")
  return `graph TD\n${body}`
}

const sanitizeNode = (value: string): string =>
  value
    .replaceAll(/[^A-Za-z0-9_]/g, "_")
    .replace(/^([0-9])/, "N_$1")
