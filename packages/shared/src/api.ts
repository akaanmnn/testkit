/** HTTP contract between the web UI and the server. */

export interface HealthResponse {
  status: 'ok';
  serverVersion: string;
  /** Server clock, so the UI can show a trustworthy "last seen" delta. */
  now: string;
  database: 'ok' | 'unreachable';
  storageRoot: 'ok' | 'unwritable';
}

export type AgentConnectionState = 'connected' | 'disconnected' | 'never-connected';

export interface AgentSummary {
  id: string;
  name: string;
  state: AgentConnectionState;
  os: string | null;
  agentVersion: string | null;
  playwrightVersion: string | null;
  /** ISO timestamp, null if the agent has never connected. */
  lastSeenAt: string | null;
  /** Wall-clock ms since the last heartbeat, null when disconnected. */
  heartbeatAgeMs: number | null;
}

export interface AgentListResponse {
  agents: AgentSummary[];
}

export interface CreateAgentRequest {
  name: string;
}

export interface CreateAgentResponse {
  agent: AgentSummary;
  /** Shown once, never retrievable again: only its hash is stored. */
  token: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Scenarios (Phase 1)
// ---------------------------------------------------------------------------

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
  status: 'draft' | 'ready' | 'archived';
  stepCount: number;
  variableCount: number;
  dataSetCount: number;
  updatedAt: string;
}

export interface ScenarioListResponse {
  scenarios: ScenarioSummary[];
}

export interface ScenarioDetailResponse {
  scenario: import('./dsl.js').ScenarioDsl;
  dataSetCount: number;
  updatedAt: string;
}

export interface CreateScenarioRequest {
  name: string;
  baseUrl: string;
  description?: string;
}

export interface UpdateScenarioRequest {
  name?: string;
  baseUrl?: string;
  description?: string | null;
  status?: 'draft' | 'ready' | 'archived';
}

/**
 * One step as the UI submits it. `id` is omitted for a new step; the server
 * assigns order from array position, so reordering is a plain array move.
 */
export interface StepInput {
  id?: string;
  type: import('./dsl.js').StepType;
  enabled?: boolean;
  selector?: string;
  label?: string;
  pageAlias?: string;
  /** The literal recorded/typed value: a URL for navigate, text for fill. */
  recordedValue?: string | null;
  /** Bind this step to a variable, so its value comes from the data set. */
  variableId?: string | null;
  options?: import('./dsl.js').StepOptions | null;
}

export interface ReplaceStepsRequest {
  steps: StepInput[];
}

export interface VariableInput {
  key: string;
  displayName?: string | null;
  type: import('./dsl.js').VariableType;
  required?: boolean;
  defaultValue?: string | null;
}

// ---------------------------------------------------------------------------
// Recording (Phase 2)
// ---------------------------------------------------------------------------

export interface StartRecordingRequest {
  agentId: string;
  targetUrl: string;
  /** Reuse a saved login so the analyst does not sign in on every recording. */
  profileName?: string;
  /** Re-record an existing scenario instead of creating a new one on commit. */
  scenarioId?: string;
}

export interface RecordingSessionResponse {
  sessionId: string;
  status: 'starting' | 'recording' | 'stopped' | 'failed' | 'discarded';
  targetUrl: string;
  agentId: string | null;
  steps: import('./dsl.js').TestStepDsl[];
  variableCandidates: import('./events.js').VariableCandidate[];
  errorMessage: string | null;
  startedAt: string;
  stoppedAt: string | null;
}

/** One analyst decision from the parameterisation screen. */
export interface ParameterisationChoice {
  stepIndex: number;
  /** false leaves the recorded literal in place. */
  parameterise: boolean;
  key?: string;
  displayName?: string;
}

export interface CommitRecordingRequest {
  name: string;
  description?: string;
  choices: ParameterisationChoice[];
  /** Steps the analyst removed in the review list. */
  droppedStepIndexes?: number[];
}

// ---------------------------------------------------------------------------
// Data sets, files and login profiles (Phase 3)
// ---------------------------------------------------------------------------

export interface StoredFileSummary {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface DataSetValueSummary {
  variableId: string;
  variableKey: string;
  variableType: import('./dsl.js').VariableType;
  required: boolean;
  textValue: string | null;
  file: StoredFileSummary | null;
}

export interface DataSetSummary {
  id: string;
  scenarioId: string;
  name: string;
  notes: string | null;
  values: DataSetValueSummary[];
  /** Variable keys with no usable value. Empty means the set can run. */
  missing: string[];
  updatedAt: string;
}

export interface DataSetListResponse {
  dataSets: DataSetSummary[];
}

export interface CreateDataSetRequest {
  name: string;
  notes?: string;
  /** Copy text values and file references from an existing set. */
  cloneFromId?: string;
}

export interface DataSetValueInput {
  variableKey: string;
  textValue?: string | null;
  fileId?: string | null;
}

export interface SetDataSetValuesRequest {
  values: DataSetValueInput[];
}

/** What a run would actually type and upload. Phase 4 consumes the same shape. */
export interface ResolvedVariable {
  key: string;
  type: import('./dsl.js').VariableType;
  /** Text, or an absolute path for a file variable. */
  value: string;
  source: 'dataSet' | 'default' | 'recorded';
}

export interface ResolutionProblem {
  variableKey: string | null;
  stepOrder: number | null;
  code:
    | 'missingRequiredValue'
    | 'fileNotOnDisk'
    | 'unboundStepWithoutValue'
    | 'noSteps'
    | 'uploadWithoutVariable';
  message: string;
}

export interface ResolutionPreview {
  scenarioId: string;
  dataSetId: string | null;
  runnable: boolean;
  variables: ResolvedVariable[];
  problems: ResolutionProblem[];
}

export interface LoginProfileSummary {
  id: string;
  name: string;
  kind: 'storageState' | 'none';
  hasStorageState: boolean;
  capturedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
}

export interface LoginProfileListResponse {
  profiles: LoginProfileSummary[];
}

// ---------------------------------------------------------------------------
// Runs (Phase 4)
// ---------------------------------------------------------------------------

export interface StartRunRequest {
  scenarioId: string;
  dataSetId?: string | null;
  loginProfileId?: string | null;
}

export interface StartBatchRunRequest {
  scenarioId: string;
  dataSetIds: string[];
  loginProfileId?: string | null;
}

export interface TestRunStepSummary {
  order: number;
  type: string;
  label: string | null;
  resolvedValue: string | null;
  status: import('./events.js').StepStatus;
  durationMs: number | null;
  errorMessage: string | null;
  screenshotUrl: string | null;
}

export interface TestRunSummary {
  id: string;
  scenarioId: string;
  scenarioName: string;
  dataSetId: string | null;
  dataSetName: string | null;
  status: import('./events.js').RunStatus;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface TestRunDetail extends TestRunSummary {
  steps: TestRunStepSummary[];
  /** Frozen copy of the data used, so history stays true after edits. */
  resolvedData: ResolvedVariable[];
}

export interface TestRunListResponse {
  runs: TestRunSummary[];
}

export interface StartRunResponse {
  runId: string;
  status: import('./events.js').RunStatus;
}

export interface StartBatchRunResponse {
  runIds: string[];
}
