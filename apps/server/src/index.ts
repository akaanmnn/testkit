import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { REPO_ROOT, SERVER_VERSION, config, ensureStorageLayout } from './config.js';
import { apiRouter } from './api/index.js';
import { attachAgentGateway, AGENT_WS_PATH } from './agents/agentGateway.js';
import { checkDatabase, prisma } from './db/prisma.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('server');

async function main(): Promise<void> {
  ensureStorageLayout();

  const databaseOk = await checkDatabase();
  if (!databaseOk) {
    log.error('cannot reach the database - run `npm run db:migrate` first');
    process.exitCode = 1;
    return;
  }

  const app = express();
  app.use(cors({ origin: config.webOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);

  // In production the built UI is served from this same process, so analysts get
  // one address, no CORS, and nothing to configure. In development Vite serves it
  // on :5173 and proxies /api here instead.
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  const hasWebBuild = existsSync(path.join(webDist, 'index.html'));
  if (hasWebBuild) {
    app.use(express.static(webDist, { index: false }));
  }

  app.use((req, res) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && hasWebBuild) {
      // The UI routes on the hash, so every path just returns the shell.
      res.sendFile(path.join(webDist, 'index.html'));
      return;
    }
    res.status(404).json({ error: { code: 'notFound', message: `${req.method} ${req.path} için bir adres yok.` } });
  });

  const httpServer = createServer(app);
  attachAgentGateway(httpServer);

  httpServer.listen(config.port, () => {
    log.info('listening', {
      version: SERVER_VERSION,
      url: `http://localhost:${config.port}`,
      webUi: hasWebBuild ? 'served from this process' : 'run `npm run dev:web` (development)',
      agentSocket: `ws://localhost:${config.port}${AGENT_WS_PATH}`,
      storageRoot: config.storageRoot,
    });
  });

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
