import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  isVersionAtLeast,
  type AgentToServerMessage,
  type ServerReject,
  type ServerWelcome,
} from '@testkit/shared';
import { SERVER_VERSION, config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../lib/logger.js';
import { agentRegistry } from './AgentRegistry.js';
import { RecordingService } from '../services/RecordingService.js';

const log = createLogger('agent-ws');

export const AGENT_WS_PATH = '/agent-ws';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function reject(socket: WebSocket, reason: ServerReject['reason'], message: string): void {
  log.warn('rejecting agent', { reason, message });
  socket.send(encodeMessage({ type: 'server.reject', reason, message }));
  socket.close(4003, reason);
}

/**
 * Phase 0 scope: accept a connection, verify the pairing token, record the
 * handshake, keep the connection alive with heartbeats. Recording commands are
 * wired in Phase 2 - the message shapes are already agreed in the protocol.
 */
export function attachAgentGateway(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: AGENT_WS_PATH });

  wss.on('connection', (socket, request) => {
    let agentId: string | null = null;
    log.info('socket opened', { remote: request.socket.remoteAddress ?? 'unknown' });

    // A socket that never says hello is not an agent. Close it quickly.
    const helloTimer = setTimeout(() => {
      if (!agentId) {
        log.warn('closing socket that never sent agent.hello');
        socket.close(4002, 'hello timeout');
      }
    }, 10_000);

    socket.on('message', async (raw) => {
      const message = decodeMessage<AgentToServerMessage>(raw.toString());
      if (!message) {
        log.warn('dropping malformed frame');
        return;
      }

      if (message.type === 'agent.hello') {
        if (agentId) return; // already greeted; ignore duplicates

        if (message.protocolVersion !== PROTOCOL_VERSION) {
          reject(
            socket,
            'protocolMismatch',
            `Sunucu protokol v${PROTOCOL_VERSION} konuşuyor, agent v${message.protocolVersion}. Agent'ı güncelleyin.`,
          );
          return;
        }
        if (!isVersionAtLeast(message.agentVersion, config.minAgentVersion)) {
          reject(
            socket,
            'agentTooOld',
            `Agent sürümü ${message.agentVersion}, gereken en düşük sürüm ${config.minAgentVersion}. Agent klasörünü yenisiyle değiştirin.`,
          );
          return;
        }

        const agent = await prisma.agent.findUnique({ where: { name: message.agentName } });
        if (!agent || agent.tokenHash !== hashToken(message.token)) {
          // One message for both cases on purpose: never reveal whether a name exists.
          reject(socket, 'badToken', 'Bu makine adı ve token eşleşmesi sunucuda kayıtlı değil. Web arayüzünden yeni config indirin.');
          return;
        }

        agentId = agent.id;
        clearTimeout(helloTimer);

        await prisma.agent.update({
          where: { id: agent.id },
          data: {
            os: message.os,
            agentVersion: message.agentVersion,
            playwrightVersion: message.playwrightVersion,
            lastSeenAt: new Date(),
          },
        });

        agentRegistry.add(agent.id, agent.name, socket);
        const welcome: ServerWelcome = {
          type: 'server.welcome',
          agentId: agent.id,
          agentName: agent.name,
          serverVersion: SERVER_VERSION,
          heartbeatIntervalMs: config.heartbeatIntervalMs,
        };
        socket.send(encodeMessage(welcome));
        return;
      }

      if (!agentId) {
        log.warn('message before hello, closing', { type: message.type });
        socket.close(4002, 'hello required first');
        return;
      }

      if (message.type === 'agent.heartbeat') {
        agentRegistry.touch(agentId);
        await prisma.agent.update({ where: { id: agentId }, data: { lastSeenAt: new Date() } });
        return;
      }

      // Recording traffic. The agent only reports; every interpretation of these
      // messages happens in RecordingService.
      switch (message.type) {
        case 'recording.started':
          await RecordingService.onStarted(message.sessionId, message.pid);
          return;
        case 'recording.action':
          await RecordingService.onAction(message.sessionId, message.seq, message.rawJsonl);
          return;
        case 'recording.stopped':
          await RecordingService.onStopped(message.sessionId, message.reason, message.errorMessage);
          return;
        default:
          log.warn('unhandled message type', { type: (message as { type: string }).type });
      }
    });

    socket.on('close', (code) => {
      clearTimeout(helloTimer);
      if (agentId) {
        agentRegistry.remove(agentId, socket);
        // A recording cannot continue without the machine that hosts the
        // browser, so end any session that was still open on it.
        void RecordingService.onAgentDisconnected(agentId);
      }
      log.info('socket closed', { code });
    });

    socket.on('error', (error: Error) => {
      log.error('socket error', { message: error.message });
    });
  });

  const sweeper = setInterval(
    () => agentRegistry.dropStale(config.agentStaleAfterMs),
    config.heartbeatIntervalMs,
  );
  sweeper.unref();

  log.info('agent gateway listening', { path: AGENT_WS_PATH });
}
