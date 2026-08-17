import type { ScenarioDsl } from '@testkit/shared';

/**
 * Where a recording physically happens. The MVP ships exactly one
 * implementation (AgentRecorderDriver, Phase 2): the browser opens on the
 * analyst's own machine and raw JSONL streams back over the agent socket.
 *
 * This interface exists so the recorder never leaks into the rest of the
 * server. Nothing outside src/recorder/ should know that Playwright codegen
 * exists, or that an agent is involved.
 */
export interface RecorderDriver {
  readonly id: 'agent';

  /** Asks the analyst's machine to open a browser and start recording. */
  start(input: { sessionId: string; agentId: string; targetUrl: string; profileName?: string }): Promise<void>;

  /** Asks it to stop. Also called when the analyst closes the browser. */
  stop(input: { sessionId: string; agentId: string }): Promise<void>;
}

/**
 * Turns raw recorder output into the DSL. Lives on the server, never in the
 * agent, so mapping fixes ship without touching analyst machines.
 *
 * Verified against playwright 1.56.0 (see apps/agent/src/smoke/jsonlSmoke.ts):
 * one JSON object per line, `name` plus `selector`, `text` / `options` /
 * `files` / `url`, and `pageAlias`, `framePath`, `locator`.
 */
export interface RecordingMapper {
  /** Called per raw line. Returns null for lines that carry no step. */
  mapAction(rawJsonl: string): unknown | null;

  /** Called on stop: cleans up noise and assembles an ordered scenario draft. */
  finalise(actions: unknown[]): Pick<ScenarioDsl, 'baseUrl' | 'steps' | 'variables'>;
}
