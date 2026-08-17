/** Server-sent events. One channel per recording session and per run. */

import type { TestStepDsl, VariableDsl } from './dsl.js';

export const recordingChannel = (sessionId: string) => `recording:${sessionId}`;
export const runChannel = (runId: string) => `run:${runId}`;

export interface RecordingStartedEvent {
  type: 'recording.started';
  sessionId: string;
}

/** One mapped step. Steps can be revised in place, hence the index. */
export interface RecordingStepEvent {
  type: 'recording.step';
  sessionId: string;
  index: number;
  step: TestStepDsl;
}

/** Emitted when cleanup drops or merges a step the UI already showed. */
export interface RecordingStepsReplacedEvent {
  type: 'recording.steps';
  sessionId: string;
  steps: TestStepDsl[];
}

export interface RecordingStoppedEvent {
  type: 'recording.stopped';
  sessionId: string;
  reason: 'user' | 'browserClosed' | 'error';
  errorMessage?: string;
  steps: TestStepDsl[];
  variableCandidates: VariableCandidate[];
}

/** A value the recorder saw that probably differs between runs. */
export interface VariableCandidate {
  /** Index into the step list this candidate came from. */
  stepIndex: number;
  suggestedKey: string;
  type: VariableDsl['type'];
  /** What was recorded: the typed text, the picked option, or the file name. */
  recordedValue: string;
  label: string;
  /** Uploads must be parameterised: only a file name was captured, never a path. */
  mandatory: boolean;
}

export type RecordingEvent =
  | RecordingStartedEvent
  | RecordingStepEvent
  | RecordingStepsReplacedEvent
  | RecordingStoppedEvent;

// ---------------------------------------------------------------------------
// Run events (Phase 4)
// ---------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';
export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface RunStartedEvent {
  type: 'run.started';
  runId: string;
  totalSteps: number;
}

export interface RunStepStartedEvent {
  type: 'run.step.started';
  runId: string;
  order: number;
  stepType: string;
  label: string | null;
  /** The value after variable resolution, so the UI shows what was really typed. */
  resolvedValue: string | null;
}

export interface RunStepFinishedEvent {
  type: 'run.step.finished';
  runId: string;
  order: number;
  status: StepStatus;
  durationMs: number;
  errorMessage: string | null;
  screenshotUrl: string | null;
}

export interface RunFinishedEvent {
  type: 'run.finished';
  runId: string;
  status: RunStatus;
  durationMs: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  errorMessage: string | null;
}

export type RunEvent = RunStartedEvent | RunStepStartedEvent | RunStepFinishedEvent | RunFinishedEvent;
