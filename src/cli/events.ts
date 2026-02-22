import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import type { ArcEvent } from "./model"

export interface ArcEventSink {
  emit(event: ArcEvent): Promise<void>
}

export class NoopArcEventSink implements ArcEventSink {
  async emit(): Promise<void> {}
}

export class CallbackArcEventSink implements ArcEventSink {
  constructor(private readonly callback: (event: ArcEvent) => Promise<void> | void) {}

  async emit(event: ArcEvent): Promise<void> {
    await this.callback(event)
  }
}

export class CompositeArcEventSink implements ArcEventSink {
  constructor(private readonly sinks: readonly ArcEventSink[]) {}

  async emit(event: ArcEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.emit(event)
    }
  }
}

export class NdjsonArcEventSink implements ArcEventSink {
  private initialized = false

  constructor(private readonly eventFilePath: string) {}

  async emit(event: ArcEvent): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.eventFilePath), { recursive: true })
      this.initialized = true
    }

    await appendFile(this.eventFilePath, `${JSON.stringify(event)}\n`, "utf8")
  }
}

export const createEvent = (
  attempt: number,
  event: { type: ArcEvent["type"] } & Record<string, unknown>,
): ArcEvent =>
  ({
    ...event,
    timestamp: new Date().toISOString(),
    attempt,
  }) as ArcEvent
