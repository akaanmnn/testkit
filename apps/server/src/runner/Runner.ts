/**
 * Where a test physically executes.
 *
 * The MVP implements ServerRunner only: headless Playwright in this process.
 * `RunTarget` is already part of the contract (and of TestRun.target in the
 * schema) so that adding an agent-side runner later - if it turns out the
 * server cannot reach the application under test - is an added implementation
 * rather than a reshaped call site.
 */
export type RunTarget = 'server' | 'agent';

export interface RunRequest {
  runId: string;
  scenarioId: string;
  dataSetId: string | null;
  loginProfileId: string | null;
  headed: boolean;
}

export interface RunOutcome {
  status: 'passed' | 'failed' | 'error' | 'cancelled';
  durationMs: number;
  errorMessage?: string;
}

export interface Runner {
  readonly target: RunTarget;
  /** Resolves when the run has finished and its results are persisted. */
  execute(request: RunRequest): Promise<RunOutcome>;
  cancel(runId: string): Promise<void>;
}
