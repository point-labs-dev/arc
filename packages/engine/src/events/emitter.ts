import type { PipelineEvent } from "./events"

export interface EventListener {
  onEvent(event: PipelineEvent): void | Promise<void>
}

export interface PipelineEventEmitter {
  emit(event: PipelineEvent): void | Promise<void>
}

export class NoopEventEmitter implements PipelineEventEmitter {
  emit(): void {}
}

export class CallbackEventEmitter implements PipelineEventEmitter {
  constructor(private readonly callback: (event: PipelineEvent) => void | Promise<void>) {}

  emit(event: PipelineEvent): void | Promise<void> {
    return this.callback(event)
  }
}

export class ListenerEventEmitter implements PipelineEventEmitter {
  constructor(private readonly listener: EventListener) {}

  emit(event: PipelineEvent): void | Promise<void> {
    return this.listener.onEvent(event)
  }
}
