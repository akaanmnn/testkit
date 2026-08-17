import { EventEmitter } from 'node:events';

/**
 * Fan-out for server-sent events. Channels are strings like
 * `recording:<sessionId>` and `run:<runId>`; the HTTP layer subscribes per
 * request and unsubscribes when the client disconnects.
 */
class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One long-lived SSE client per channel per analyst is normal; the default
    // limit of 10 would warn during a batch run.
    this.emitter.setMaxListeners(100);
  }

  publish(channel: string, payload: unknown): void {
    this.emitter.emit(channel, payload);
  }

  subscribe(channel: string, listener: (payload: unknown) => void): () => void {
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}

export const eventBus = new EventBus();
