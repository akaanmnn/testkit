import type {
  AgentListResponse,
  ApiErrorBody,
  CreateAgentResponse,
  CommitRecordingRequest,
  CreateDataSetRequest,
  CreateScenarioRequest,
  DataSetListResponse,
  DataSetSummary,
  DataSetValueInput,
  HealthResponse,
  RecordingSessionResponse,
  ResolutionPreview,
  StartBatchRunResponse,
  StartRecordingRequest,
  StartRunResponse,
  StoredFileSummary,
  ScenarioDetailResponse,
  ScenarioListResponse,
  StepInput,
  TestRunDetail,
  TestRunListResponse,
  UpdateScenarioRequest,
  VariableInput,
} from '@testkit/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: keep the status line.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  listAgents: () => request<AgentListResponse>('/agents'),
  createAgent: (name: string) =>
    request<CreateAgentResponse>('/agents', { method: 'POST', body: JSON.stringify({ name }) }),
  rotateToken: (id: string) =>
    request<CreateAgentResponse>(`/agents/${id}/rotate-token`, { method: 'POST' }),
  deleteAgent: (id: string) => request<void>(`/agents/${id}`, { method: 'DELETE' }),

  listScenarios: () => request<ScenarioListResponse>('/scenarios'),
  getScenario: (id: string) => request<ScenarioDetailResponse>(`/scenarios/${id}`),
  createScenario: (body: CreateScenarioRequest) =>
    request<ScenarioDetailResponse>('/scenarios', { method: 'POST', body: JSON.stringify(body) }),
  updateScenario: (id: string, body: UpdateScenarioRequest) =>
    request<ScenarioDetailResponse>(`/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteScenario: (id: string) => request<void>(`/scenarios/${id}`, { method: 'DELETE' }),
  replaceSteps: (id: string, steps: StepInput[]) =>
    request<ScenarioDetailResponse>(`/scenarios/${id}/steps`, { method: 'PUT', body: JSON.stringify({ steps }) }),
  addVariable: (id: string, body: VariableInput) =>
    request<ScenarioDetailResponse>(`/scenarios/${id}/variables`, { method: 'POST', body: JSON.stringify(body) }),
  updateVariable: (variableId: string, body: Partial<VariableInput>) =>
    request<ScenarioDetailResponse>(`/variables/${variableId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteVariable: (variableId: string) =>
    request<ScenarioDetailResponse>(`/variables/${variableId}`, { method: 'DELETE' }),

  startRecording: (body: StartRecordingRequest) =>
    request<RecordingSessionResponse>('/recordings', { method: 'POST', body: JSON.stringify(body) }),
  stopRecording: (sessionId: string) =>
    request<RecordingSessionResponse>(`/recordings/${sessionId}/stop`, { method: 'POST' }),
  commitRecording: (sessionId: string, body: CommitRecordingRequest) =>
    request<ScenarioDetailResponse>(`/recordings/${sessionId}/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  discardRecording: (sessionId: string) => request<void>(`/recordings/${sessionId}`, { method: 'DELETE' }),

  listDataSets: (scenarioId: string) => request<DataSetListResponse>(`/scenarios/${scenarioId}/datasets`),
  createDataSet: (scenarioId: string, body: CreateDataSetRequest) =>
    request<DataSetSummary>(`/scenarios/${scenarioId}/datasets`, { method: 'POST', body: JSON.stringify(body) }),
  setDataSetValues: (dataSetId: string, values: DataSetValueInput[]) =>
    request<DataSetSummary>(`/datasets/${dataSetId}/values`, { method: 'PUT', body: JSON.stringify({ values }) }),
  deleteDataSet: (dataSetId: string) => request<void>(`/datasets/${dataSetId}`, { method: 'DELETE' }),

  /** Multipart, so it bypasses the JSON request helper. */
  uploadFile: async (file: File): Promise<StoredFileSummary> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/files', { method: 'POST', body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? 'Dosya yüklenemedi.');
    }
    return (await response.json()) as StoredFileSummary;
  },

  /** What a run would type and upload, and what stops it. */
  resolve: (scenarioId: string, dataSetId: string | null) =>
    request<ResolutionPreview>(
      `/scenarios/${scenarioId}/resolve${dataSetId ? `?dataSetId=${dataSetId}` : ''}`,
    ),

  startRun: (scenarioId: string, dataSetId: string | null) =>
    request<StartRunResponse>('/runs', { method: 'POST', body: JSON.stringify({ scenarioId, dataSetId }) }),
  startBatchRun: (scenarioId: string, dataSetIds: string[]) =>
    request<StartBatchRunResponse>('/runs/batch', {
      method: 'POST',
      body: JSON.stringify({ scenarioId, dataSetIds }),
    }),
  listRuns: (scenarioId?: string, limit?: number) => {
    const query = new URLSearchParams();
    if (scenarioId) query.set('scenarioId', scenarioId);
    if (limit) query.set('limit', String(limit));
    const suffix = query.toString();
    return request<TestRunListResponse>(`/runs${suffix ? `?${suffix}` : ''}`);
  },
  getRun: (runId: string) => request<TestRunDetail>(`/runs/${runId}`),
  cancelRun: (runId: string) => request<void>(`/runs/${runId}/cancel`, { method: 'POST' }),
};
