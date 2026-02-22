export type StageStatus = "success" | "fail" | "partial_success" | "retry" | "skipped"

export interface Outcome {
  readonly status: StageStatus
  readonly preferred_label: string
  readonly suggested_next_ids: string[]
  readonly context_updates: Record<string, unknown>
  readonly notes: string
  readonly failure_reason: string
}

export const outcome = (input: Omit<Partial<Outcome>, "status"> & { status: string }): Outcome => ({
  status: normalizeStageStatus(input.status),
  preferred_label: input.preferred_label ?? "",
  suggested_next_ids: input.suggested_next_ids ?? [],
  context_updates: input.context_updates ?? {},
  notes: input.notes ?? "",
  failure_reason: input.failure_reason ?? "",
})

export const successOutcome = (input: Partial<Omit<Outcome, "status">> = {}): Outcome =>
  outcome({
    status: "success",
    ...input,
  })

export const failOutcome = (
  reason: string,
  input: Partial<Omit<Outcome, "status">> = {},
): Outcome =>
  outcome({
    status: "fail",
    failure_reason: reason,
    ...input,
  })

export const normalizeOutcome = (input: unknown): Outcome => {
  if (!isOutcomeLike(input)) {
    return failOutcome("Handler returned an invalid outcome payload")
  }

  return outcome({
    status: input.status,
    preferred_label: typeof input.preferred_label === "string" ? input.preferred_label : "",
    suggested_next_ids: Array.isArray(input.suggested_next_ids)
      ? input.suggested_next_ids.filter((value): value is string => typeof value === "string")
      : [],
    context_updates:
      typeof input.context_updates === "object" && input.context_updates !== null
        ? { ...(input.context_updates as Record<string, unknown>) }
        : {},
    notes: typeof input.notes === "string" ? input.notes : "",
    failure_reason: typeof input.failure_reason === "string" ? input.failure_reason : "",
  })
}

export const isSuccessfulOutcome = (value: Outcome): boolean =>
  value.status === "success" || value.status === "partial_success"

export const normalizeStageStatus = (value: string): StageStatus => {
  const normalized = value.trim().toLowerCase()
  if (normalized === "success") {
    return "success"
  }
  if (normalized === "fail" || normalized === "failed") {
    return "fail"
  }
  if (normalized === "partial_success" || normalized === "partial-success") {
    return "partial_success"
  }
  if (normalized === "retry") {
    return "retry"
  }
  if (normalized === "skipped") {
    return "skipped"
  }
  return "fail"
}

const isOutcomeLike = (
  value: unknown,
): value is {
  status: string
  preferred_label?: unknown
  suggested_next_ids?: unknown
  context_updates?: unknown
  notes?: unknown
  failure_reason?: unknown
} => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  if (!("status" in value) || typeof value.status !== "string") {
    return false
  }

  return true
}
