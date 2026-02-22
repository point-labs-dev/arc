export class PipelineContext {
  private readonly values = new Map<string, unknown>()
  private readonly logs: string[] = []

  constructor(initialValues: Record<string, unknown> = {}, initialLogs: string[] = []) {
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key, value)
    }
    this.logs.push(...initialLogs)
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value)
  }

  get<TValue = unknown>(key: string, fallback?: TValue): TValue | undefined {
    if (!this.values.has(key)) {
      return fallback
    }
    return this.values.get(key) as TValue
  }

  has(key: string): boolean {
    return this.values.has(key)
  }

  getString(key: string, fallback = ""): string {
    const value = this.get(key)
    if (value === undefined || value === null) {
      return fallback
    }
    return String(value)
  }

  appendLog(entry: string): void {
    this.logs.push(entry)
  }

  logEntries(): string[] {
    return [...this.logs]
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries())
  }

  clone(): PipelineContext {
    return new PipelineContext(this.snapshot(), this.logEntries())
  }

  applyUpdates(updates: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(updates)) {
      this.values.set(key, value)
    }
  }

  static fromSnapshot(values: Record<string, unknown>, logs: string[] = []): PipelineContext {
    return new PipelineContext(values, logs)
  }
}
