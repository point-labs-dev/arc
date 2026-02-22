import { readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import { type Outcome, failOutcome, successOutcome } from "../context/outcome"
import {
  type Answer,
  AutoApproveInterviewer,
  type Interviewer,
  type Option,
  type Question,
} from "../interviewer"
import type { GraphDefinition, GraphEdge, GraphNode } from "../types"
import type { Handler } from "./handler"

interface Choice {
  readonly key: string
  readonly label: string
  readonly to: string
}

export class WaitForHumanHandler implements Handler {
  private readonly interviewer: Interviewer

  constructor(interviewer?: Interviewer) {
    this.interviewer = interviewer ?? new AutoApproveInterviewer()
  }

  async execute(
    node: GraphNode,
    _context: PipelineContext,
    graph: GraphDefinition,
    _logsRoot?: string,
  ): Promise<Outcome> {
    const choices = graph.edges
      .filter((edge) => edge.from === node.id)
      .map((edge) => this.edgeToChoice(edge))

    if (choices.length === 0) {
      return failOutcome(`No outgoing edges for human gate "${node.id}"`)
    }

    const options: Option[] = choices.map((choice) => ({
      key: choice.key,
      label: choice.label,
    }))

    const question: Question = {
      text: readAttributeString(node.attrs, "label", "Select an option:"),
      type: "MULTIPLE_CHOICE",
      options,
      stage: node.id,
    }

    const answer = await this.interviewer.ask(question)

    let selected = selectChoiceFromAnswer(choices, answer)

    if (String(answer.value).toUpperCase() === "TIMEOUT") {
      const defaultChoice = readAttributeString(node.attrs, "human.default_choice").trim()
      if (defaultChoice.length === 0) {
        return {
          ...failOutcome("human gate timeout, no default choice"),
          status: "retry",
        }
      }

      selected =
        findChoice(choices, defaultChoice) ??
        findChoice(choices, defaultChoice.toUpperCase()) ??
        selected
    }

    if (String(answer.value).toUpperCase() === "SKIPPED") {
      return failOutcome("human skipped interaction")
    }

    if (selected === undefined) {
      selected = choices[0]
    }

    return successOutcome({
      preferred_label: selected.label,
      suggested_next_ids: [selected.to],
      context_updates: {
        "human.gate.selected": selected.key,
        "human.gate.label": selected.label,
      },
      notes: `Human selected "${selected.label}" on ${node.id}`,
    })
  }

  private edgeToChoice(edge: GraphEdge): Choice {
    const label = readAttributeString(edge.attrs, "label").trim()
    const resolvedLabel = label.length > 0 ? label : edge.to
    return {
      key: parseAcceleratorKey(resolvedLabel),
      label: resolvedLabel,
      to: edge.to,
    }
  }
}

const selectChoiceFromAnswer = (choices: Choice[], answer: Answer): Choice | undefined => {
  const candidates = [
    answer.selected_option?.key,
    typeof answer.value === "string" ? answer.value : undefined,
    answer.text,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0)

  for (const candidate of candidates) {
    const match = findChoice(choices, candidate)
    if (match !== undefined) {
      return match
    }
  }

  return undefined
}

const findChoice = (choices: Choice[], token: string): Choice | undefined => {
  const normalized = token.trim().toLowerCase()
  return choices.find((choice) => {
    if (choice.key.toLowerCase() === normalized) {
      return true
    }
    if (choice.label.trim().toLowerCase() === normalized) {
      return true
    }
    return choice.to.toLowerCase() === normalized
  })
}

const parseAcceleratorKey = (label: string): string => {
  const bracket = label.match(/^\[([^\]]+)\]/)
  if (bracket !== null && bracket[1].trim().length > 0) {
    return bracket[1].trim().charAt(0).toUpperCase()
  }

  const paren = label.match(/^([A-Za-z0-9])\)/)
  if (paren !== null) {
    return paren[1].toUpperCase()
  }

  const hyphen = label.match(/^([A-Za-z0-9])\s*-\s*/)
  if (hyphen !== null) {
    return hyphen[1].toUpperCase()
  }

  for (const char of label.trim()) {
    if (/[A-Za-z0-9]/.test(char)) {
      return char.toUpperCase()
    }
  }

  return "?"
}
