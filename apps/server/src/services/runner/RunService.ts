import path from 'node:path';
import type {
  ResolvedVariable,
  RunStatus,
  StartBatchRunRequest,
  StartRunRequest,
  TestRunDetail,
  TestRunSummary,
} from '@testkit/shared';
import { runChannel } from '@testkit/shared';
import { absoluteStoragePath, storagePaths } from '../../config.js';
import { prisma } from '../../db/prisma.js';
import { eventBus } from '../../lib/eventBus.js';
import { ApiError, badRequest, notFound } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { scenarioInclude, toScenarioDsl } from '../scenarioMapper.js';
import { LoginProfileService } from '../LoginProfileService.js';
import { VariableResolver } from '../VariableResolver.js';
import { executeScenario, type StepResult } from './PlaywrightExecutor.js';
import type { RunTarget, Runner } from '../../runner/Runner.js';

const log = createLogger('runs');

/**
 * One run at a time.
 *
 * Two analysts sharing one machine will occasionally press Run together, and a
 * browser is the most expensive thing this server does. A queue of one keeps
 * memory predictable and results reproducible; raising it is a constant, not a
 * redesign. This is deliberately an in-process queue rather than Redis: the work
 * is minutes long, the queue is at most a handful of items, and durability across
 * a restart is not worth another service.
 */
const QUEUE_CONCURRENCY = 1;

interface QueueItem {
  runId: string;
}

const queue: QueueItem[] = [];
const cancelled = new Set<string>();
let active = 0;

function artifactUrl(runId: string, file: string | null): string | null {
  return file ? `/api/runs/${runId}/artifacts/${file}` : null;
}

function countByStatus(steps: { status: string }[]) {
  return {
    passedCount: steps.filter((step) => step.status === 'passed').length,
    failedCount: steps.filter((step) => step.status === 'failed').length,
    skippedCount: steps.filter((step) => step.status === 'skipped').length,
  };
}

type RunRow = {
  id: string;
  scenarioId: string;
  dataSetId: string | null;
  status: string;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  errorMessage: string | null;
  resolvedDataJson: string | null;
  scenario: { name: string };
  dataSet: { name: string } | null;
  steps: {
    order: number;
    type: string;
    label: string | null;
    resolvedValue: string | null;
    status: string;
    durationMs: number | null;
    errorMessage: string | null;
    screenshotPath: string | null;
  }[];
};

function toSummary(row: RunRow): TestRunSummary {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    scenarioName: row.scenario.name,
    dataSetId: row.dataSetId,
    dataSetName: row.dataSet?.name ?? null,
    status: row.status as RunStatus,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
    ...countByStatus(row.steps),
  };
}

function toDetail(row: RunRow): TestRunDetail {
  let resolvedData: ResolvedVariable[] = [];
  if (row.resolvedDataJson) {
    try {
      resolvedData = JSON.parse(row.resolvedDataJson) as ResolvedVariable[];
    } catch {
      resolvedData = [];
    }
  }
  return {
    ...toSummary(row),
    resolvedData,
    steps: [...row.steps]
      .sort((a, b) => a.order - b.order)
      .map((step) => ({
        order: step.order,
        type: step.type,
        label: step.label,
        resolvedValue: step.resolvedValue,
        status: step.status as TestRunDetail['steps'][number]['status'],
        durationMs: step.durationMs,
        errorMessage: step.errorMessage,
        screenshotUrl: artifactUrl(row.id, step.screenshotPath),
      })),
  };
}

const runInclude = {
  scenario: { select: { name: true } },
  dataSet: { select: { name: true } },
  steps: true,
} as const;

export const RunService = {
  /**
   * Validates first, queues second. Everything that can be known before a
   * browser opens is checked here, so a missing spreadsheet fails in
   * milliseconds with a sentence an analyst can act on.
   */
  async start(input: StartRunRequest): Promise<{ runId: string; status: RunStatus }> {
    const scenarioId = input.scenarioId;
    const dataSetId = input.dataSetId ?? null;

    const preview = await VariableResolver.resolve(scenarioId, dataSetId);
    if (!preview.runnable) {
      throw new ApiError(422, 'notRunnable', preview.problems[0]?.message ?? 'Bu senaryo çalıştırılamaz.', {
        problems: preview.problems,
      });
    }

    if (input.loginProfileId) {
      const profile = await prisma.loginProfile.findUnique({ where: { id: input.loginProfileId } });
      if (!profile) throw notFound('profileNotFound', 'Bu oturum profili artık mevcut değil.');
    }

    const run = await prisma.testRun.create({
      data: {
        scenarioId,
        dataSetId,
        loginProfileId: input.loginProfileId ?? null,
        // MVP runs on the server. The column exists so an agent-side runner is
        // an added implementation later, not a reshaped call site.
        target: 'server' satisfies RunTarget,
        status: 'queued',
        headed: false,
        // Frozen now, not at execution time: this is what the analyst asked for.
        resolvedDataJson: JSON.stringify(preview.variables),
      },
    });

    queue.push({ runId: run.id });
    log.info('run queued', { runId: run.id, scenarioId, dataSetId, queued: queue.length });
    void pump();

    return { runId: run.id, status: 'queued' };
  },

  /** Same scenario, several data sets: the point of keeping data separate. */
  async startBatch(input: StartBatchRunRequest): Promise<string[]> {
    if (!Array.isArray(input.dataSetIds) || input.dataSetIds.length === 0) {
      throw badRequest('noDataSets', 'En az bir veri seti seçin.');
    }
    const runIds: string[] = [];
    for (const dataSetId of input.dataSetIds) {
      const started = await this.start({
        scenarioId: input.scenarioId,
        dataSetId,
        loginProfileId: input.loginProfileId ?? null,
      });
      runIds.push(started.runId);
    }
    return runIds;
  },

  async list(filter: { scenarioId?: string; limit?: number }): Promise<TestRunSummary[]> {
    const rows = await prisma.testRun.findMany({
      where: filter.scenarioId ? { scenarioId: filter.scenarioId } : undefined,
      orderBy: { queuedAt: 'desc' },
      take: Math.min(filter.limit ?? 50, 200),
      include: runInclude,
    });
    return rows.map(toSummary);
  },

  async get(runId: string): Promise<TestRunDetail> {
    const row = await prisma.testRun.findUnique({ where: { id: runId }, include: runInclude });
    if (!row) throw notFound('runNotFound', 'Bu koşu kaydı artık mevcut değil.');
    return toDetail(row);
  },

  async cancel(runId: string): Promise<void> {
    const row = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!row) throw notFound('runNotFound', 'Bu koşu kaydı artık mevcut değil.');
    if (row.status !== 'queued' && row.status !== 'running') {
      throw badRequest('runFinished', 'Bu koşu zaten tamamlanmış.');
    }

    cancelled.add(runId);
    const index = queue.findIndex((item) => item.runId === runId);
    if (index >= 0) {
      // Still waiting: it can be closed out immediately.
      queue.splice(index, 1);
      await prisma.testRun.update({
        where: { id: runId },
        data: { status: 'cancelled', finishedAt: new Date(), errorMessage: 'Koşu iptal edildi.' },
      });
      publishFinished(runId, 'cancelled', 0, [], 'Koşu iptal edildi.');
      cancelled.delete(runId);
    }
    // Already running: the executor checks between steps and stops there.
  },

  /** Where a run's screenshots live on disk. */
  artifactDir(runId: string): string {
    return absoluteStoragePath(storagePaths.artifacts, runId);
  },
};

function publishFinished(
  runId: string,
  status: RunStatus,
  durationMs: number,
  results: StepResult[],
  errorMessage: string | null,
): void {
  eventBus.publish(runChannel(runId), {
    type: 'run.finished',
    runId,
    status,
    durationMs,
    ...countByStatus(results),
    errorMessage,
  });
}

async function pump(): Promise<void> {
  if (active >= QUEUE_CONCURRENCY) return;
  const item = queue.shift();
  if (!item) return;

  active += 1;
  try {
    await execute(item.runId);
  } catch (error) {
    log.error('run crashed', { runId: item.runId, message: (error as Error).message });
    await prisma.testRun
      .update({
        where: { id: item.runId },
        data: { status: 'error', finishedAt: new Date(), errorMessage: (error as Error).message },
      })
      .catch(() => undefined);
  } finally {
    active -= 1;
    cancelled.delete(item.runId);
    void pump();
  }
}

async function execute(runId: string): Promise<void> {
  const run = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!run) return;

  const scenarioRow = await prisma.testScenario.findUnique({
    where: { id: run.scenarioId },
    include: scenarioInclude,
  });
  if (!scenarioRow) throw new Error('Senaryo koşu başlamadan silinmiş.');
  const scenario = toScenarioDsl(scenarioRow);

  const resolved: ResolvedVariable[] = run.resolvedDataJson
    ? (JSON.parse(run.resolvedDataJson) as ResolvedVariable[])
    : [];
  const storageStatePath = await LoginProfileService.storageStatePath(run.loginProfileId);

  const artifactDir = RunService.artifactDir(runId);
  const startedAt = Date.now();

  await prisma.testRun.update({
    where: { id: runId },
    data: {
      status: 'running',
      startedAt: new Date(),
      artifactDir: path.join(storagePaths.artifacts, runId),
    },
  });

  const enabledCount = scenario.steps.filter((step) => step.enabled).length;
  eventBus.publish(runChannel(runId), { type: 'run.started', runId, totalSteps: enabledCount });
  log.info('run started', { runId, scenario: scenario.name, steps: enabledCount });

  const outcome = await executeScenario({
    runId,
    baseUrl: scenario.baseUrl,
    steps: scenario.steps,
    resolved,
    storageStatePath,
    artifactDir,
    headed: false,
    isCancelled: () => cancelled.has(runId),
    onStepStart: (step) => {
      eventBus.publish(runChannel(runId), {
        type: 'run.step.started',
        runId,
        order: step.order,
        stepType: step.type,
        label: step.label,
        resolvedValue: step.resolvedValue,
      });
    },
    onStepFinish: (result) => {
      // Persisted as it happens, so a crashed process still leaves a readable run.
      void prisma.testRunStep
        .create({
          data: {
            runId,
            order: result.order,
            type: result.type,
            label: result.label,
            resolvedValue: result.resolvedValue,
            status: result.status,
            durationMs: result.durationMs,
            errorMessage: result.errorMessage,
            screenshotPath: result.screenshotFile,
          },
        })
        .catch((error: Error) => log.warn('step not saved', { runId, message: error.message }));

      eventBus.publish(runChannel(runId), {
        type: 'run.step.finished',
        runId,
        order: result.order,
        status: result.status,
        durationMs: result.durationMs,
        errorMessage: result.errorMessage,
        screenshotUrl: artifactUrl(runId, result.screenshotFile),
      });
    },
  });

  const durationMs = Date.now() - startedAt;
  await prisma.testRun.update({
    where: { id: runId },
    data: {
      status: outcome.status,
      finishedAt: new Date(),
      durationMs,
      errorMessage: outcome.errorMessage,
    },
  });

  publishFinished(runId, outcome.status, durationMs, outcome.results, outcome.errorMessage);
  log.info('run finished', { runId, status: outcome.status, durationMs });
}

/** The Runner contract from Phase 0, now with a server-side implementation. */
export const serverRunner: Runner = {
  target: 'server',
  async execute(request) {
    const startedAt = Date.now();
    await execute(request.runId);
    const row = await prisma.testRun.findUnique({ where: { id: request.runId } });
    return {
      status: (row?.status as 'passed' | 'failed' | 'error' | 'cancelled') ?? 'error',
      durationMs: row?.durationMs ?? Date.now() - startedAt,
      errorMessage: row?.errorMessage ?? undefined,
    };
  },
  async cancel(runId) {
    await RunService.cancel(runId);
  },
};
