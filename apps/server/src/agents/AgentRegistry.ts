import type { WebSocket } from 'ws';
import type { AgentConnectionState, ServerToAgentMessage } from '@testkit/shared';
import { encodeMessage } from '@testkit/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('agents');

interface LiveAgent {
  agentId: string;
  agentName: string;
  socket: WebSocket;
  connectedAt: number;
  lastHeartbeatAt: number;
}

/**
 * Which agents are connected right now. Deliberately in-memory: connection
 * state is not durable data, and a server restart genuinely means "no agent is
 * connected" until each agent reconnects. Durable facts (name, version, last
 * seen) live in the Agent table.
 */
export class AgentRegistry {
  private readonly byId = new Map<string, LiveAgent>();

  add(agentId: string, agentName: string, socket: WebSocket): void {
    const existing = this.byId.get(agentId);
    if (existing && existing.socket !== socket) {
      // Same agent reconnecting (laptop woke up, network flapped). Drop the old
      // socket so we never hold two sockets for one machine.
      log.warn('replacing existing connection', { agentId, agentName });
      existing.socket.close(4000, 'replaced by a newer connection');
    }
    const now = Date.now();
    this.byId.set(agentId, { agentId, agentName, socket, connectedAt: now, lastHeartbeatAt: now });
    log.info('agent connected', { agentId, agentName, liveCount: this.byId.size });
  }

  remove(agentId: string, socket: WebSocket): void {
    const existing = this.byId.get(agentId);
    if (!existing || existing.socket !== socket) return;
    this.byId.delete(agentId);
    log.info('agent disconnected', { agentId, liveCount: this.byId.size });
  }

  touch(agentId: string): void {
    const agent = this.byId.get(agentId);
    if (agent) agent.lastHeartbeatAt = Date.now();
  }

  isConnected(agentId: string): boolean {
    return this.byId.has(agentId);
  }

  stateFor(agentId: string, hasEverConnected: boolean): AgentConnectionState {
    if (this.byId.has(agentId)) return 'connected';
    return hasEverConnected ? 'disconnected' : 'never-connected';
  }

  heartbeatAgeMs(agentId: string): number | null {
    const agent = this.byId.get(agentId);
    return agent ? Date.now() - agent.lastHeartbeatAt : null;
  }

  /** Phase 2 uses this to deliver recording.start / recording.stop. */
  send(agentId: string, message: ServerToAgentMessage): boolean {
    const agent = this.byId.get(agentId);
    if (!agent) return false;
    agent.socket.send(encodeMessage(message));
    return true;
  }

  /** Closes sockets that stopped sending heartbeats, so state does not go stale. */
  dropStale(staleAfterMs: number): void {
    const cutoff = Date.now() - staleAfterMs;
    for (const agent of [...this.byId.values()]) {
      if (agent.lastHeartbeatAt < cutoff) {
        log.warn('agent heartbeat timed out', { agentId: agent.agentId, agentName: agent.agentName });
        agent.socket.close(4001, 'heartbeat timeout');
        this.byId.delete(agent.agentId);
      }
    }
  }

  connectedIds(): string[] {
    return [...this.byId.keys()];
  }
}

export const agentRegistry = new AgentRegistry();
