import { readAttributeString } from "../attributes"
import type { PipelineContext } from "../context/context"
import { failOutcome, normalizeOutcome, successOutcome } from "../context/outcome"
import type { GraphDefinition, GraphNode } from "../types"
import type { Handler } from "./handler"
import { type ParallelBranchResult, normalizeParallelBranchResults } from "./parallel-results"

const OUTCOME_RANK: Record<string, number> = {
  success: 0,
  partial_success: 1,
  retry: 2,
  skipped: 3,
  fail: 4,
}

export class FanInHandler implements Handler {
  execute(node: GraphNode, context: PipelineContext, _graph: GraphDefinition, _logsRoot?: string) {
    const resultsKey =
      readAttributeString(node.attrs, "parallel.results_key", "parallel.results").trim() ||
      "parallel.results"
    const rawResults = context.get(resultsKey) ?? context.get("parallel.results")
    const results = normalizeParallelBranchResults(rawResults)

    if (results.length === 0) {
      return failOutcome("No parallel results to evaluate")
    }

    const ranked = [...results].sort(compareBranchResults)
    const best = ranked[0]
    if (best.outcome.status === "fail") {
      return failOutcome("All parallel branches failed", {
        context_updates: {
          "parallel.fan_in.candidate_count": results.length,
          "parallel.fan_in.failed_count": results.filter(
            (result) => result.outcome.status === "fail",
          ).length,
        },
      })
    }

    return successOutcome({
      context_updates: {
        "parallel.fan_in.best_id": best.branch_id,
        "parallel.fan_in.best_score": best.score,
        "parallel.fan_in.best_outcome": normalizeOutcome(best.outcome),
        "parallel.fan_in.candidate_count": results.length,
      },
      notes: `Selected best candidate: ${best.branch_id}`,
    })
  }
}

const compareBranchResults = (left: ParallelBranchResult, right: ParallelBranchResult): number => {
  const leftRank = OUTCOME_RANK[left.outcome.status] ?? Number.MAX_SAFE_INTEGER
  const rightRank = OUTCOME_RANK[right.outcome.status] ?? Number.MAX_SAFE_INTEGER
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (left.score !== right.score) {
    return right.score - left.score
  }

  return left.branch_id.localeCompare(right.branch_id)
}
