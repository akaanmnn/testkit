import { Router } from 'express';
import { healthRouter } from './health.js';
import { agentsRouter } from './agents.js';
import { scenariosRouter } from './scenarios.js';
import { recordingsRouter } from './recordings.js';
import { eventsRouter } from './events.js';
import { dataSetsRouter } from './datasets.js';
import { filesRouter } from './files.js';
import { runsRouter } from './runs.js';

export const apiRouter = Router();
apiRouter.use(healthRouter);
apiRouter.use(agentsRouter);
apiRouter.use(scenariosRouter);
apiRouter.use(recordingsRouter);
apiRouter.use(eventsRouter);
apiRouter.use(dataSetsRouter);
apiRouter.use(filesRouter);
apiRouter.use(runsRouter);
