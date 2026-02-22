export type ApprovalMode = "required" | "optional" | "none"
export type BackendMode = "pi" | "mock"

export interface ArcVerificationConfig {
  readonly commands: readonly string[]
  readonly timeout: number
  readonly holdout_command?: string
  readonly holdout_timeout?: number
}

export interface ArcConvergenceConfig {
  readonly maxAttempts: number
  readonly satisfactionThreshold: number
  readonly freshContextPerAttempt: boolean
}

export interface ArcModelConfig {
  readonly default: string
  readonly planning: string
  readonly satisfaction: string
  readonly provider: string
}

export interface ArcParallelConfig {
  readonly maxSessions: number
  readonly useWorktrees: boolean
}

export interface ArcMonitoringConfig {
  readonly discordChannel: string
  readonly progressInterval: number
  readonly eventsLogPath: string
}

export interface ArcBackendConfig {
  readonly mode: BackendMode
  readonly timeout: number
}

export interface ArcHumanGateConfig {
  readonly enabled: boolean
  readonly mode: ApprovalMode
  readonly command?: string
  readonly timeout: number
}

export interface ArcDigitalTwinConfig {
  readonly enabled: boolean
  readonly provider: string
  readonly endpoint: string
  readonly command?: string
}

export interface ArcProjectConfig {
  readonly verification: ArcVerificationConfig
  readonly convergence: ArcConvergenceConfig
  readonly model: ArcModelConfig
  readonly approval: ApprovalMode
  readonly parallel: ArcParallelConfig
  readonly monitoring: ArcMonitoringConfig
  readonly backend: ArcBackendConfig
  readonly humanGate: ArcHumanGateConfig
  readonly digitalTwin: ArcDigitalTwinConfig
}

export interface ProgressState {
  readonly totalAttempts: number
  readonly specItemsCompleted: readonly string[]
  readonly specItemsPending: readonly string[]
  readonly lastAttemptAt: string | null
  readonly overallSatisfaction: number
}

export interface AttemptLearning {
  readonly attemptNumber: number
  readonly attempted: string
  readonly worked: readonly string[]
  readonly failed: readonly string[]
  readonly filesChanged: readonly string[]
  readonly keyLearning: string
  readonly verificationSummary: string
  readonly backendSummary: string
}

export interface StandardCommandResult {
  readonly command: string
  readonly passed: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface StandardVerificationResult {
  readonly passed: boolean
  readonly commands: readonly StandardCommandResult[]
  readonly durationMs: number
}

export interface HoldoutVerificationResult {
  readonly passed: boolean
  readonly scenarioCount: number
  readonly failedScenarioIds: readonly string[]
  readonly summary: string
}

export interface SatisfactionVerificationResult {
  readonly score: number
  readonly threshold: number
  readonly passed: boolean
  readonly rationale: string
}

export interface VerificationResult {
  readonly passed: boolean
  readonly standard: StandardVerificationResult
  readonly holdout: HoldoutVerificationResult
  readonly satisfaction: SatisfactionVerificationResult
}

export interface ArcEventBase {
  readonly type: string
  readonly timestamp: string
  readonly attempt: number
}

export type ArcEvent =
  | (ArcEventBase & {
      readonly type: "spec_read"
      readonly specPath: string
    })
  | (ArcEventBase & {
      readonly type: "attempt_start"
      readonly attemptId: string
      readonly backendMode: BackendMode
    })
  | (ArcEventBase & {
      readonly type: "attempt_end"
      readonly attemptId: string
      readonly backendSummary: string
      readonly success: boolean
    })
  | (ArcEventBase & {
      readonly type: "verification_start"
      readonly commandCount: number
    })
  | (ArcEventBase & {
      readonly type: "verification_end"
      readonly passed: boolean
      readonly summary: string
    })
  | (ArcEventBase & {
      readonly type: "holdout_start"
      readonly scenarioCount: number
    })
  | (ArcEventBase & {
      readonly type: "holdout_end"
      readonly scenarioCount: number
      readonly passed: boolean
      readonly failedScenarioIds: readonly string[]
    })
  | (ArcEventBase & {
      readonly type: "satisfaction_score"
      readonly score: number
      readonly threshold: number
      readonly passed: boolean
    })
  | (ArcEventBase & {
      readonly type: "learning_persisted"
      readonly path: string
    })
  | (ArcEventBase & {
      readonly type: "commit"
      readonly hash: string
      readonly message: string
      readonly filesChanged: readonly string[]
    })
  | (ArcEventBase & {
      readonly type: "human_gate"
      readonly mode: ApprovalMode
      readonly approved: boolean
      readonly reason: string
    })
  | (ArcEventBase & {
      readonly type: "alert"
      readonly level: "warn" | "error"
      readonly message: string
    })

export interface AttemptBackendResponse {
  readonly summary: string
  readonly rawResponse: string
}

export interface AttemptBackendSession {
  run(prompt: string): Promise<AttemptBackendResponse>
  close(): Promise<void>
}

export interface AttemptBackendFactory {
  createFreshSession(): Promise<AttemptBackendSession>
}

export interface HumanApprovalRequest {
  readonly attempt: number
  readonly summary: string
  readonly filesChanged: readonly string[]
}

export type ApprovalStatus = "approved" | "rejected" | "skipped"

export interface ApprovalDecision {
  readonly status: ApprovalStatus
  readonly reason: string
}

export interface DigitalTwinEnvironment {
  readonly id: string
  readonly endpoint: string
  readonly metadata: Record<string, string>
}

export interface ConvergenceResult {
  readonly success: boolean
  readonly attemptsUsed: number
  readonly message: string
}
