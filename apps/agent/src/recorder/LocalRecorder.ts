import type { RecordingStartCommand, RecordingStopCommand } from '@testkit/shared';

/**
 * What the server can ask an analyst machine to do. `CodegenRecorder` is the
 * only implementation; the interface keeps the agent's transport code unaware of
 * how recording actually happens, so a different local recorder (a browser
 * extension bridge, say) would not touch ServerConnection.
 */
export interface LocalRecorder {
  handle(command: RecordingStartCommand | RecordingStopCommand): void;
  activeSessionIds(): string[];
  stopAll(): void;
}
