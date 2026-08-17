import { Router } from 'express';
import { param } from '../lib/http.js';
import { DataSetService } from '../services/DataSetService.js';
import { VariableResolver } from '../services/VariableResolver.js';
import { sendError } from '../lib/errors.js';

export const dataSetsRouter = Router();

dataSetsRouter.get('/scenarios/:id/datasets', async (req, res) => {
  try {
    res.json({ dataSets: await DataSetService.listForScenario(param(req, 'id')) });
  } catch (error) {
    sendError(res, error);
  }
});

dataSetsRouter.post('/scenarios/:id/datasets', async (req, res) => {
  try {
    res.status(201).json(await DataSetService.create(param(req, 'id'), req.body ?? {}));
  } catch (error) {
    sendError(res, error);
  }
});

dataSetsRouter.get('/datasets/:dataSetId', async (req, res) => {
  try {
    res.json(await DataSetService.get(param(req, 'dataSetId')));
  } catch (error) {
    sendError(res, error);
  }
});

dataSetsRouter.patch('/datasets/:dataSetId', async (req, res) => {
  try {
    res.json(await DataSetService.rename(param(req, 'dataSetId'), req.body ?? {}));
  } catch (error) {
    sendError(res, error);
  }
});

dataSetsRouter.put('/datasets/:dataSetId/values', async (req, res) => {
  try {
    res.json(await DataSetService.setValues(param(req, 'dataSetId'), req.body?.values));
  } catch (error) {
    sendError(res, error);
  }
});

dataSetsRouter.delete('/datasets/:dataSetId', async (req, res) => {
  try {
    await DataSetService.remove(param(req, 'dataSetId'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Preflight: what a run would type and upload, and what stops it. The UI calls
 * this before enabling Run, and Phase 4's runner calls the same resolver, so the
 * answer shown and the answer used cannot drift.
 */
dataSetsRouter.get('/scenarios/:id/resolve', async (req, res) => {
  try {
    const dataSetId = typeof req.query.dataSetId === 'string' && req.query.dataSetId.length > 0
      ? req.query.dataSetId
      : null;
    res.json(await VariableResolver.resolve(param(req, 'id'), dataSetId));
  } catch (error) {
    sendError(res, error);
  }
});
