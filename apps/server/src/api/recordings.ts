import { Router } from 'express';
import { param } from '../lib/http.js';
import { RecordingService } from '../services/RecordingService.js';
import { sendError } from '../lib/errors.js';

export const recordingsRouter = Router();

recordingsRouter.post('/recordings', async (req, res) => {
  try {
    res.status(201).json(await RecordingService.start(req.body));
  } catch (error) {
    sendError(res, error);
  }
});

recordingsRouter.get('/recordings/:id', async (req, res) => {
  try {
    res.json(await RecordingService.get(param(req, 'id')));
  } catch (error) {
    sendError(res, error);
  }
});

recordingsRouter.post('/recordings/:id/stop', async (req, res) => {
  try {
    res.json(await RecordingService.stop(param(req, 'id')));
  } catch (error) {
    sendError(res, error);
  }
});

recordingsRouter.post('/recordings/:id/commit', async (req, res) => {
  try {
    res.status(201).json(await RecordingService.commit(param(req, 'id'), req.body));
  } catch (error) {
    sendError(res, error);
  }
});

recordingsRouter.delete('/recordings/:id', async (req, res) => {
  try {
    await RecordingService.discard(param(req, 'id'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});
