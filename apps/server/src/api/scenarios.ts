import { Router } from 'express';
import { param } from '../lib/http.js';
import { ScenarioService } from '../services/ScenarioService.js';
import { sendError } from '../lib/errors.js';

export const scenariosRouter = Router();

scenariosRouter.get('/scenarios', async (_req, res) => {
  try {
    res.json({ scenarios: await ScenarioService.list() });
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.post('/scenarios', async (req, res) => {
  try {
    res.status(201).json(await ScenarioService.create(req.body));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.get('/scenarios/:id', async (req, res) => {
  try {
    res.json(await ScenarioService.get(param(req, 'id')));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.patch('/scenarios/:id', async (req, res) => {
  try {
    res.json(await ScenarioService.update(param(req, 'id'), req.body));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.delete('/scenarios/:id', async (req, res) => {
  try {
    await ScenarioService.remove(param(req, 'id'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

/** Full replace: the UI sends the whole list, so order is array position. */
scenariosRouter.put('/scenarios/:id/steps', async (req, res) => {
  try {
    res.json(await ScenarioService.replaceSteps(param(req, 'id'), req.body?.steps));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.post('/scenarios/:id/variables', async (req, res) => {
  try {
    res.status(201).json(await ScenarioService.addVariable(param(req, 'id'), req.body));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.patch('/variables/:variableId', async (req, res) => {
  try {
    res.json(await ScenarioService.updateVariable(param(req, 'variableId'), req.body));
  } catch (error) {
    sendError(res, error);
  }
});

scenariosRouter.delete('/variables/:variableId', async (req, res) => {
  try {
    res.json(await ScenarioService.removeVariable(param(req, 'variableId')));
  } catch (error) {
    sendError(res, error);
  }
});
