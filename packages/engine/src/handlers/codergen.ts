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
    const prompt = this.buildPrompt(node, graph)
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

    const result = successOutcome({
      notes: `Stage completed: ${node.id}`,
      context_updates: {
        last_stage: node.id,
        last_response: truncate(responseText, 200),
      },
    })

    await writeStageStatusArtifact(logsRoot, node.id, result)
    return result
  }

  private buildPrompt(node: GraphNode, graph: GraphDefinition): string {
    const explicitPrompt = readAttributeString(node.attrs, "prompt").trim()
    const basePrompt =
      explicitPrompt.length > 0 ? explicitPrompt : readAttributeString(node.attrs, "label", node.id)

    const goal = readAttributeString(graph.attrs, "goal")
    return basePrompt.replaceAll("$goal", goal)
  }
}

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`

const isOutcomeLike = (value: unknown): value is Outcome =>
  typeof value === "object" && value !== null && "status" in value
