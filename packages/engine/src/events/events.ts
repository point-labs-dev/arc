export type PipelineEvent =
  | {
      readonly type: "pipeline_started"
      readonly pipeline_id: string
      readonly pipeline_name: string
      readonly started_at: string
    }
  | {
      readonly type: "pipeline_completed"
      readonly pipeline_id: string
      readonly duration_ms: number
    }
  | {
      readonly type: "pipeline_failed"
      readonly pipeline_id: string
      readonly duration_ms: number
      readonly error: string
    }
  | {
      readonly type: "stage_started"
      readonly node_id: string
      readonly attempt: number
    }
  | {
      readonly type: "stage_completed"
      readonly node_id: string
      readonly attempt: number
      readonly duration_ms: number
      readonly status: string
    }
  | {
      readonly type: "stage_failed"
      readonly node_id: string
      readonly attempt: number
      readonly duration_ms: number
      readonly error: string
      readonly will_retry: boolean
    }
  | {
      readonly type: "stage_retrying"
      readonly node_id: string
      readonly attempt: number
      readonly delay_ms: number
    }
  | {
      readonly type: "checkpoint_saved"
      readonly node_id: string
      readonly path: string
    }
  | {
      readonly type: "holdout_start"
      readonly scenario_count: number
      readonly started_at: string
    }
  | {
      readonly type: "holdout_scenario_start"
      readonly scenario_id: string
      readonly scenario_name: string
    }
  | {
      readonly type: "holdout_scenario_end"
      readonly scenario_id: string
      readonly scenario_name: string
      readonly passed: boolean
      readonly duration_ms: number
      readonly error?: string
    }
  | {
      readonly type: "holdout_end"
      readonly scenario_count: number
      readonly passed: boolean
      readonly duration_ms: number
      readonly failed_scenario_ids: readonly string[]
    }
  | {
      readonly type: "satisfaction_score"
      readonly score: number
      readonly threshold: number
      readonly passed: boolean
      readonly rationale: string
    }
