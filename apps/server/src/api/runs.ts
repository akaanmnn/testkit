import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { RunService } from '../services/runner/RunService.js';
import { badRequest, notFound, sendError } from '../lib/errors.js';
import { param } from '../lib/http.js';

export const runsRouter = Router();

runsRouter.post('/runs', async (req, res) => {
  try {
    // 202: the run is accepted and queued, not finished. The UI follows it over SSE.
    res.status(202).json(await RunService.start(req.body ?? {}));
  } catch (error) {
    sendError(res, error);
  }
});

runsRouter.post('/runs/batch', async (req, res) => {
  try {
    res.status(202).json({ runIds: await RunService.startBatch(req.body ?? {}) });
  } catch (error) {
    sendError(res, error);
  }
});

runsRouter.get('/runs', async (req, res) => {
  try {
    const scenarioId = typeof req.query.scenarioId === 'string' ? req.query.scenarioId : undefined;
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
    res.json({ runs: await RunService.list({ scenarioId, limit }) });
  } catch (error) {
    sendError(res, error);
  }
});

runsRouter.get('/runs/:runId', async (req, res) => {
  try {
    res.json(await RunService.get(param(req, 'runId')));
  } catch (error) {
    sendError(res, error);
  }
});

runsRouter.post('/runs/:runId/cancel', async (req, res) => {
  try {
    await RunService.cancel(param(req, 'runId'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

/** Screenshots. Only plain file names are served from the run's own folder. */
runsRouter.get('/runs/:runId/artifacts/:file', async (req, res) => {
  try {
    const runId = param(req, 'runId');
    const file = param(req, 'file');
    if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) {
      throw badRequest('invalidFileName', 'Geçersiz dosya adı.');
    }
    const absolute = path.join(RunService.artifactDir(runId), file);
    if (!existsSync(absolute)) throw notFound('artifactNotFound', 'Bu ekran görüntüsü bulunamadı.');
    res.sendFile(absolute);
  } catch (error) {
    sendError(res, error);
  }
});
