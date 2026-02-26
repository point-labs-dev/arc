import { readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import { type Outcome, normalizeOutcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import { writeStageStatusArtifact, writeStageTextArtifact } from "./artifacts"
import type { Handler } from "./handler"

export interface CodergenBackend {
  run(
    node: GraphNode,
    prompt: string,
    context: PipelineContext,
  ): Promise<string | Outcome> | string | Outcome
}

export class CodergenHandler implements Handler {
  constructor(private readonly backend?: CodergenBackend) {}

  async execute(
    node: GraphNode,
    context: PipelineContext,
    graph: GraphDefinition,
    logsRoot?: string,
  ): Promise<Outcome> {
    const prompt = this.buildPrompt(node, graph, context)
    await writeStageTextArtifact(logsRoot, node.id, "prompt.md", prompt)

    let responseText = ""
    if (this.backend !== undefined) {
      try {
        const result = await this.backend.run(node, prompt, context)
        if (isOutcomeLike(result)) {
          const normalized = normalizeOutcome(result)
          await writeStageStatusArtifact(logsRoot, node.id, normalized)
          return normalized
        }
        responseText = String(result)
      } catch (error) {
        const failed = normalizeOutcome({
          status: "fail",
          failure_reason: error instanceof Error ? error.message : String(error),
        })
        await writeStageStatusArtifact(logsRoot, node.id, failed)
        return failed
      }
    } else {
      responseText = `[Simulated] Response for stage: ${node.id}`
    }

    await writeStageTextArtifact(logsRoot, node.id, "response.md", responseText)

    const structured = parseStructuredOutcome(responseText)
    const result =
      structured ??
      successOutcome({
        notes: `Stage completed: ${node.id}`,
        context_updates: {
          last_stage: node.id,
          last_response: truncate(responseText, 200),
        },
      })

    await writeStageStatusArtifact(logsRoot, node.id, result)
    return result
  }

  private buildPrompt(node: GraphNode, graph: GraphDefinition, context: PipelineContext): string {
    const explicitPrompt = readAttributeString(node.attrs, "prompt").trim()
    const basePrompt =
      explicitPrompt.length > 0 ? explicitPrompt : readAttributeString(node.attrs, "label", node.id)

    const goal = readAttributeString(graph.attrs, "goal")
    const withGoal = basePrompt.replaceAll("$goal", goal)
    return withGoal.replace(/\$([A-Za-z_][A-Za-z0-9_.]*)/g, (match, key: string) => {
      if (key === "goal") {
        return goal
      }

      const direct = context.get(key)
      if (direct !== undefined && direct !== null) {
        return String(direct)
      }

      const prefixed = context.get(`context.${key}`)
      if (prefixed !== undefined && prefixed !== null) {
        return String(prefixed)
      }

      return match
    })
  }
}

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`

const isOutcomeLike = (value: unknown): value is Outcome =>
  typeof value === "object" && value !== null && "status" in value

const parseStructuredOutcome = (responseText: string): Outcome | undefined => {
  const trimmed = responseText.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const direct = parseJsonObject(trimmed)
  if (direct !== undefined && isOutcomeLike(direct)) {
    return normalizeOutcome(direct)
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)
  if (fenced === null) {
    return undefined
  }

  const parsed = parseJsonObject(fenced[1])
  if (parsed !== undefined && isOutcomeLike(parsed)) {
    return normalizeOutcome(parsed)
  }

  return undefined
}

const parseJsonObject = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== "object" || parsed === null) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}
