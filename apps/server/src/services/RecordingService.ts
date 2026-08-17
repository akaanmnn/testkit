import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  CommitRecordingRequest,
  RecordingSessionResponse,
  StartRecordingRequest,
  TestStepDsl,
  VariableCandidate,
} from '@testkit/shared';
import { recordingChannel } from '@testkit/shared';
import { absoluteStoragePath, storagePaths } from '../config.js';
import { prisma } from '../db/prisma.js';
import { eventBus } from '../lib/eventBus.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { agentRegistry } from '../agents/AgentRegistry.js';
import { cleanup, mapAction, parseRawLine, variableCandidates } from './jsonlToDsl.js';
import { ScenarioService } from './ScenarioService.js';

const log = createLogger('recording');

interface LiveSession {
  sessionId: string;
  agentId: string;
  targetUrl: string;
  scenarioId: string | null;
  rawPath: string;
  /** Raw steps in arrival order, before cleanup. */
  rawSteps: TestStepDsl[];
  /** Cleaned list, which is what the UI shows and what commit uses. */
  steps: TestStepDsl[];
  candidates: VariableCandidate[];
  lastSeq: number;
}

/**
 * Recording sessions are short-lived and only meaningful while an agent is
 * connected, so the live buffer is in memory. What survives a restart is the
 * database row plus the raw JSONL on disk, which is enough to explain what
 * happened and to re-run the mapper over an old capture.
 */
const live = new Map<string, LiveSession>();

function publish(sessionId: string, payload: unknown): void {
  eventBus.publish(recordingChannel(sessionId), payload);
}

function toResponse(session: {
  id: string;
  status: string;
  targetUrl: string;
  agentId: string | null;
  errorMessage: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
}): RecordingSessionResponse {
  const buffered = live.get(session.id);
  return {
    sessionId: session.id,
    status: session.status as RecordingSessionResponse['status'],
    targetUrl: session.targetUrl,
    agentId: session.agentId,
    steps: buffered?.steps ?? [],
    variableCandidates: buffered?.candidates ?? [],
    errorMessage: session.errorMessage,
    startedAt: session.startedAt.toISOString(),
    stoppedAt: session.stoppedAt?.toISOString() ?? null,
  };
}

export const RecordingService = {
  async start(input: StartRecordingRequest): Promise<RecordingSessionResponse> {
    const targetUrl = (input.targetUrl ?? '').trim();
    try {
      new URL(targetUrl);
    } catch {
      throw badRequest('invalidUrl', 'Kaydedilecek adresi tam olarak yazın, https:// dahil.');
    }

    const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
    if (!agent) throw notFound('agentNotFound', 'Bu makine kayıtlı değil.');
    if (!agentRegistry.isConnected(agent.id)) {
      throw new ApiError(
        409,
        'agentOffline',
        `${agent.name} bağlı değil. O bilgisayarda TestKit Agent'ı başlatıp tekrar deneyin.`,
      );
    }

    if (input.scenarioId) {
      const scenario = await prisma.testScenario.findUnique({ where: { id: input.scenarioId } });
      if (!scenario) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');
    }

    const session = await prisma.recordingSession.create({
      data: {
        agentId: agent.id,
        scenarioId: input.scenarioId ?? null,
        targetUrl,
        status: 'starting',
      },
    });

    const dir = absoluteStoragePath(storagePaths.recordings, session.id);
    mkdirSync(dir, { recursive: true });
    const rawPath = path.join(dir, 'session.jsonl');
    await prisma.recordingSession.update({
      where: { id: session.id },
      data: { rawJsonlPath: path.relative(absoluteStoragePath(), rawPath) },
    });

    live.set(session.id, {
      sessionId: session.id,
      agentId: agent.id,
      targetUrl,
      scenarioId: input.scenarioId ?? null,
      rawPath,
      rawSteps: [],
      steps: [],
      candidates: [],
      lastSeq: 0,
    });

    const delivered = agentRegistry.send(agent.id, {
      type: 'recording.start',
      sessionId: session.id,
      targetUrl,
      profileName: input.profileName,
    });
    if (!delivered) {
      await this.markFailed(session.id, `${agent.name} kayıt başlamadan bağlantıyı kaybetti.`);
      throw new ApiError(409, 'agentOffline', `${agent.name} kayıt başlamadan bağlantıyı kaybetti.`);
    }

    log.info('recording requested', { sessionId: session.id, agent: agent.name, targetUrl });
    return toResponse(await prisma.recordingSession.findUniqueOrThrow({ where: { id: session.id } }));
  },

  /** The agent confirms the local browser is up. */
  async onStarted(sessionId: string, pid: number): Promise<void> {
    await prisma.recordingSession.updateMany({ where: { id: sessionId }, data: { status: 'recording' } });
    log.info('recording started', { sessionId, pid });
    publish(sessionId, { type: 'recording.started', sessionId });
  },

  /**
   * One raw JSONL line. Everything interpretive happens here rather than on the
   * analyst's machine.
   */
  async onAction(sessionId: string, seq: number, rawJsonl: string): Promise<void> {
    const session = live.get(sessionId);
    if (!session) {
      log.warn('action for an unknown session', { sessionId, seq });
      return;
    }
    if (seq <= session.lastSeq) return; // duplicate after a reconnect
    session.lastSeq = seq;

    // Keep the raw capture verbatim: it is the evidence when a mapping looks wrong.
    try {
      appendFileSync(session.rawPath, `${rawJsonl}\n`);
    } catch (error) {
      log.warn('could not persist raw line', { sessionId, message: (error as Error).message });
    }

    const action = parseRawLine(rawJsonl);
    if (!action) return;
    const step = mapAction(action);
    if (!step) return;

    session.rawSteps.push(step);
    const before = session.steps;
    session.steps = cleanup(session.rawSteps);
    session.candidates = variableCandidates(session.steps);

    await prisma.recordingSession.updateMany({
      where: { id: sessionId },
      data: { actionCount: session.rawSteps.length },
    });

    // Cleanup can merge or drop a step the UI already drew, so send the whole
    // list in that case instead of an append that would leave it out of sync.
    if (session.steps.length === before.length + 1) {
      const added = session.steps[session.steps.length - 1];
      publish(sessionId, {
        type: 'recording.step',
        sessionId,
        index: session.steps.length - 1,
        step: added,
      });
    } else {
      publish(sessionId, { type: 'recording.steps', sessionId, steps: session.steps });
    }
  },

  /** Requested from the UI. */
  async stop(sessionId: string): Promise<RecordingSessionResponse> {
    const row = await prisma.recordingSession.findUnique({ where: { id: sessionId } });
    if (!row) throw notFound('sessionNotFound', 'Bu kayıt oturumu artık mevcut değil.');
    if (row.status === 'recording' || row.status === 'starting') {
      if (row.agentId) agentRegistry.send(row.agentId, { type: 'recording.stop', sessionId });
    }
    return toResponse(row);
  },

  /** The agent reports the recorder exited, whoever asked for it. */
  async onStopped(
    sessionId: string,
    reason: 'user' | 'browserClosed' | 'error',
    errorMessage?: string,
  ): Promise<void> {
    const session = live.get(sessionId);
    await prisma.recordingSession.updateMany({
      where: { id: sessionId },
      data: {
        status: reason === 'error' ? 'failed' : 'stopped',
        stoppedAt: new Date(),
        errorMessage: errorMessage ?? null,
      },
    });
    log.info('recording stopped', { sessionId, reason, steps: session?.steps.length ?? 0 });

    publish(sessionId, {
      type: 'recording.stopped',
      sessionId,
      reason,
      errorMessage,
      steps: session?.steps ?? [],
      variableCandidates: session?.candidates ?? [],
    });
  },

  async markFailed(sessionId: string, message: string): Promise<void> {
    await prisma.recordingSession.updateMany({
      where: { id: sessionId },
      data: { status: 'failed', errorMessage: message, stoppedAt: new Date() },
    });
    publish(sessionId, { type: 'recording.stopped', sessionId, reason: 'error', errorMessage: message, steps: [], variableCandidates: [] });
  },

  /** Called when an agent socket drops, so a session cannot sit "recording" forever. */
  async onAgentDisconnected(agentId: string): Promise<void> {
    const orphans = await prisma.recordingSession.findMany({
      where: { agentId, status: { in: ['starting', 'recording'] } },
    });
    for (const orphan of orphans) {
      await this.onStopped(orphan.id, 'error', 'Kayıt sürerken agent bağlantısı koptu.');
    }
  },

  async get(sessionId: string): Promise<RecordingSessionResponse> {
    const row = await prisma.recordingSession.findUnique({ where: { id: sessionId } });
    if (!row) throw notFound('sessionNotFound', 'Bu kayıt oturumu artık mevcut değil.');
    return toResponse(row);
  },

  /**
   * Turns the reviewed capture into a scenario. This is where a recording stops
   * being a transcript and becomes a test: chosen values become variables, and
   * the steps that used them are bound to those variables instead of literals.
   */
  async commit(sessionId: string, input: CommitRecordingRequest) {
    const session = live.get(sessionId);
    if (!session) {
      throw new ApiError(
        409,
        'sessionExpired',
        'Bu kayıt artık bellekte değil. Yeniden kaydedin; ham kayıt storage klasöründe duruyor.',
      );
    }
    if (session.steps.length === 0) {
      throw badRequest('emptyRecording', 'Hiçbir aksiyon kaydedilmedi, kaydedilecek bir senaryo yok.');
    }

    const dropped = new Set(input.droppedStepIndexes ?? []);
    const kept = session.steps.filter((_, index) => !dropped.has(index));
    if (kept.length === 0) {
      throw badRequest('allStepsDropped', 'Bütün adımlar çıkarıldı. Senaryoyu kaydetmek için en az bir adım kalmalı.');
    }

    // Map old indexes to the kept list so the analyst's choices still line up.
    const indexMap = new Map<number, number>();
    session.steps.forEach((_, oldIndex) => {
      if (!dropped.has(oldIndex)) indexMap.set(oldIndex, indexMap.size);
    });

    const scenario = session.scenarioId
      ? await ScenarioService.get(session.scenarioId)
      : await ScenarioService.create({
          name: input.name,
          baseUrl: kept.find((s) => s.type === 'navigate')?.value ?? session.targetUrl,
          description: input.description,
        });
    const scenarioId = scenario.scenario.id;

    // 1. Declare the variables the analyst confirmed.
    const keyByStepIndex = new Map<number, string>();
    for (const choice of input.choices ?? []) {
      if (!choice.parameterise) continue;
      const candidate = session.candidates.find((c) => c.stepIndex === choice.stepIndex);
      if (!candidate) continue;
      if (!indexMap.has(choice.stepIndex)) continue; // its step was dropped

      const key = (choice.key ?? candidate.suggestedKey).trim();
      const existing = (await ScenarioService.get(scenarioId)).scenario.variables.find((v) => v.key === key);
      if (!existing) {
        await ScenarioService.addVariable(scenarioId, {
          key,
          type: candidate.type,
          displayName: choice.displayName ?? candidate.label,
          required: true,
        });
      }
      keyByStepIndex.set(choice.stepIndex, key);
    }

    // An upload cannot run from a recorded file name, so it always gets a
    // variable even if the analyst skipped the checkbox.
    for (const candidate of session.candidates) {
      if (!candidate.mandatory || keyByStepIndex.has(candidate.stepIndex)) continue;
      if (!indexMap.has(candidate.stepIndex)) continue;
      const key = candidate.suggestedKey;
      const existing = (await ScenarioService.get(scenarioId)).scenario.variables.find((v) => v.key === key);
      if (!existing) {
        await ScenarioService.addVariable(scenarioId, { key, type: 'file', required: true });
      }
      keyByStepIndex.set(candidate.stepIndex, key);
    }

    // 2. Write the steps, bound to those variables.
    const variables = (await ScenarioService.get(scenarioId)).scenario.variables;
    const variableIdByKey = new Map(variables.map((v) => [v.key, v.id]));

    const stepInputs = session.steps
      .map((step, oldIndex) => ({ step, oldIndex }))
      .filter(({ oldIndex }) => !dropped.has(oldIndex))
      .map(({ step, oldIndex }) => {
        const key = keyByStepIndex.get(oldIndex);
        return {
          type: step.type,
          enabled: step.enabled,
          selector: step.target?.selector,
          label: step.target?.label,
          pageAlias: step.target?.pageAlias,
          recordedValue: step.recordedValue ?? null,
          variableId: key ? (variableIdByKey.get(key) ?? null) : null,
          options: step.options ?? null,
        };
      });

    const saved = await ScenarioService.replaceSteps(scenarioId, stepInputs);

    await prisma.recordingSession.updateMany({
      where: { id: sessionId },
      data: { scenarioId, status: 'stopped' },
    });
    live.delete(sessionId);
    log.info('recording committed', { sessionId, scenarioId, steps: stepInputs.length });

    return saved;
  },

  async discard(sessionId: string): Promise<void> {
    live.delete(sessionId);
    await prisma.recordingSession.updateMany({ where: { id: sessionId }, data: { status: 'discarded' } });
  },
};
