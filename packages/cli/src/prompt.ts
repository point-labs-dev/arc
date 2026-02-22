export interface AttemptPromptInput {
  readonly specText: string
  readonly progressLearnings: readonly string[]
  readonly projectSnapshot: string
  readonly attemptNumber: number
}

export const buildAttemptPrompt = (input: AttemptPromptInput): string => {
  const learningsBlock =
    input.progressLearnings.length === 0
      ? "No persisted learnings yet."
      : input.progressLearnings.join("\n\n---\n\n")

  return [
    `You are Arc attempt ${input.attemptNumber}.`,
    "",
    "Rules:",
    "- Use the specification below as the source of truth.",
    "- Do not request holdout scenario files.",
    "- Implement the next most important work toward full spec satisfaction.",
    "- Keep changes incremental and verifiable.",
    "",
    "## Specification",
    input.specText.trim(),
    "",
    "## Persisted learnings from previous attempts",
    learningsBlock,
    "",
    "## Current project state",
    input.projectSnapshot.trim(),
    "",
    "When you finish, summarize what changed and what remains.",
  ].join("\n")
}
