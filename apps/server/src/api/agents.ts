import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { param } from '../lib/http.js';
import type {
  AgentListResponse,
  AgentSummary,
  CreateAgentRequest,
  CreateAgentResponse,
} from '@testkit/shared';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { agentRegistry } from '../agents/AgentRegistry.js';
import { hashToken } from '../agents/agentGateway.js';
import { ApiError, badRequest, notFound, sendError } from '../lib/errors.js';

export const agentsRouter = Router();

function toSummary(agent: {
  id: string;
  name: string;
  os: string | null;
  agentVersion: string | null;
  playwrightVersion: string | null;
  lastSeenAt: Date | null;
}): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    state: agentRegistry.stateFor(agent.id, agent.lastSeenAt !== null),
    os: agent.os,
    agentVersion: agent.agentVersion,
    playwrightVersion: agent.playwrightVersion,
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    heartbeatAgeMs: agentRegistry.heartbeatAgeMs(agent.id),
  };
}

agentsRouter.get('/agents', async (_req, res) => {
  try {
    const agents = await prisma.agent.findMany({ orderBy: { name: 'asc' } });
    const body: AgentListResponse = { agents: agents.map(toSummary) };
    res.json(body);
  } catch (error) {
    sendError(res, error);
  }
});

/** Registers a machine and returns its pairing token once. */
agentsRouter.post('/agents', async (req, res) => {
  try {
    const { name } = req.body as CreateAgentRequest;
    if (typeof name !== 'string' || name.trim().length < 2) {
      throw badRequest('invalidName', 'Makineye en az 2 karakterlik bir ad verin, örneğin AHMET-PC.');
    }
    const trimmed = name.trim().toUpperCase();

    const existing = await prisma.agent.findUnique({ where: { name: trimmed } });
    if (existing) {
      throw new ApiError(409, 'nameInUse', `${trimmed} adlı makine zaten kayıtlı.`);
    }

    const token = randomBytes(24).toString('base64url');
    const agent = await prisma.agent.create({
      data: { name: trimmed, tokenHash: hashToken(token) },
    });

    const body: CreateAgentResponse = { agent: toSummary(agent), token };
    res.status(201).json(body);
  } catch (error) {
    sendError(res, error);
  }
});

/** Issues a fresh token, for example after a machine is reimaged. */
agentsRouter.post('/agents/:id/rotate-token', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: param(req, 'id') } });
    if (!agent) throw notFound('agentNotFound', 'Bu makine kayıtlı değil.');

    const token = randomBytes(24).toString('base64url');
    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { tokenHash: hashToken(token) },
    });
    const body: CreateAgentResponse = { agent: toSummary(updated), token };
    res.json(body);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * A ready-to-use config for a machine, as a download.
 *
 * This is what removes setup from the analyst's side: an admin registers the
 * machine here, downloads this file into the agent folder, and the analyst only
 * has to start the program. Issuing the file rotates the token, because the
 * previous one may have been handed out already.
 */
agentsRouter.get('/agents/:id/config', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: param(req, 'id') } });
    if (!agent) throw notFound('agentNotFound', 'Bu makine kayıtlı değil.');

    const token = randomBytes(24).toString('base64url');
    await prisma.agent.update({ where: { id: agent.id }, data: { tokenHash: hashToken(token) } });

    // The UI is served from the same host as the API, so the address the browser
    // used is the address the agent should dial.
    const serverUrl = `${req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`;
    const body = { serverUrl, token, agentName: agent.name };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="testkit-agent.config.json"');
    res.send(`${JSON.stringify(body, null, 2)}\n`);
  } catch (error) {
    sendError(res, error);
  }
});

agentsRouter.delete('/agents/:id', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: param(req, 'id') } });
    if (!agent) throw notFound('agentNotFound', 'Bu makine kayıtlı değil.');
    await prisma.agent.delete({ where: { id: agent.id } });
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});
