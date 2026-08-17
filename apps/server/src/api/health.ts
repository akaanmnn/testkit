import { Router } from 'express';
import type { HealthResponse } from '@testkit/shared';
import { SERVER_VERSION, absoluteStoragePath, storagePaths } from '../config.js';
import { checkDatabase } from '../db/prisma.js';
import { accessSync, constants } from 'node:fs';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const databaseOk = await checkDatabase();

  let storageOk = true;
  try {
    accessSync(absoluteStoragePath(storagePaths.files), constants.W_OK);
  } catch {
    storageOk = false;
  }

  const body: HealthResponse = {
    status: 'ok',
    serverVersion: SERVER_VERSION,
    now: new Date().toISOString(),
    database: databaseOk ? 'ok' : 'unreachable',
    storageRoot: storageOk ? 'ok' : 'unwritable',
  };
  res.json(body);
});
