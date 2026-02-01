/**
 * Plan Types
 * 
 * A plan represents a complete specification for what Arc should build.
 * Plans are created in the planning phase and executed in the Arc loop.
 */

import { Schema } from "@effect/schema"

// === Verification ===

export const VerificationType = Schema.Union(
  Schema.Literal("exit_code_0"),
  Schema.Literal("output_contains"),
  Schema.Literal("file_exists"),
  Schema.Literal("file_contains"),
  Schema.Literal("manual")
)
export type VerificationType = Schema.Schema.Type<typeof VerificationType>

export const Verification = Schema.Struct({
  type: VerificationType,
  command: Schema.optional(Schema.String),
  expect: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
})
export type Verification = Schema.Schema.Type<typeof Verification>

// === Step ===

export const StepStatus = Schema.Union(
  Schema.Literal("pending"),
  Schema.Literal("in_progress"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("skipped")
)
export type StepStatus = Schema.Schema.Type<typeof StepStatus>

export const Step = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  details: Schema.optional(Schema.String),
  verification: Schema.optional(Verification),
  status: StepStatus,
  attempts: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
})
export type Step = Schema.Schema.Type<typeof Step>

// === Context ===

export const PlanContext = Schema.Struct({
  files: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
  constraints: Schema.optional(Schema.Array(Schema.String)),
  techStack: Schema.optional(Schema.Array(Schema.String)),
})
export type PlanContext = Schema.Schema.Type<typeof PlanContext>

// === Plan ===

export const Plan = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  context: PlanContext,
  steps: Schema.Array(Step),
  created: Schema.String,
  updated: Schema.String,
  status: Schema.optional(Schema.Union(
    Schema.Literal("planning"),
    Schema.Literal("ready"),
    Schema.Literal("executing"),
    Schema.Literal("completed"),
    Schema.Literal("failed")
  )),
})
export type Plan = Schema.Schema.Type<typeof Plan>

// === Plan Creation ===

export interface CreatePlanInput {
  name: string
  description: string
  context?: Partial<PlanContext>
}

export interface AddStepInput {
  description: string
  details?: string
  verification?: Verification
}

// === Plan Utilities ===

export const createPlan = (input: CreatePlanInput): Plan => ({
  id: crypto.randomUUID(),
  name: input.name,
  description: input.description,
  context: {
    files: input.context?.files,
    notes: input.context?.notes,
    constraints: input.context?.constraints,
    techStack: input.context?.techStack,
  },
  steps: [],
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  status: "planning",
})

export const addStep = (plan: Plan, input: AddStepInput): Plan => ({
  ...plan,
  steps: [
    ...plan.steps,
    {
      id: `step-${plan.steps.length + 1}`,
      description: input.description,
      details: input.details,
      verification: input.verification,
      status: "pending",
    },
  ],
  updated: new Date().toISOString(),
})

export const updateStep = (plan: Plan, stepId: string, updates: Partial<Step>): Plan => ({
  ...plan,
  steps: plan.steps.map((step) =>
    step.id === stepId ? { ...step, ...updates } : step
  ),
  updated: new Date().toISOString(),
})

export const getPendingSteps = (plan: Plan): Step[] =>
  plan.steps.filter((step) => step.status === "pending" || step.status === "failed")

export const getCurrentStep = (plan: Plan): Step | undefined =>
  plan.steps.find((step) => step.status === "pending" || step.status === "in_progress")

export const isComplete = (plan: Plan): boolean =>
  plan.steps.every((step) => step.status === "completed" || step.status === "skipped")
