import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type AgentToServerMessage,
  type ServerToAgentMessage,
} from '@testkit/shared';
import { AGENT_VERSION, describeOs, detectPlaywrightVersion, type AgentConfig } from './config.js';

type CommandHandler = (message: ServerToAgentMessage) => void;

/**
 * Outbound-only connection to the central server. The agent dials the server,
 * so the analyst machine never opens a port and the browser is never asked to
 * talk to localhost.
 *
 * Reconnects with capped exponential backoff: laptops sleep, VPNs drop, and an
 * agent that gives up after one failure means an analyst who has to remember to
 * restart it.
 */
export class ServerConnection {
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1_000;
  private stopped = false;
  private readonly handlers: CommandHandler[] = [];
  private activeSessions: () => string[] = () => [];

  constructor(
    private readonly config: AgentConfig,
    private readonly log: (message: string) => void,
  ) {}

  onCommand(handler: CommandHandler): void {
    this.handlers.push(handler);
  }

  /** Lets the heartbeat report which sessions this machine still has open. */
  setActiveSessions(source: () => string[]): void {
    this.activeSessions = source;
  }

  send(message: AgentToServerMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.log(`Baglanti yok, gonderilemedi: ${message.type}`);
      return;
    }
    this.socket.send(encodeMessage(message));
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.socket?.close(1000, 'agent shutting down');
    this.socket = null;
  }

  private socketUrl(): string {
    const url = new URL(this.config.serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/agent-ws';
    return url.toString();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const url = this.socketUrl();
    this.log(`Sunucuya baglaniliyor: ${url}`);

    // Resolve this *before* opening the socket. Awaiting anything between
    // `new WebSocket()` and `socket.on('open')` can lose the open event, and a
    // socket that never says hello gets closed by the server 10s later.
    const playwrightVersion = await detectPlaywrightVersion();

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectDelayMs = 1_000;
      this.send({
        type: 'agent.hello',
        protocolVersion: PROTOCOL_VERSION,
        token: this.config.token,
        agentName: this.config.agentName,
        agentVersion: AGENT_VERSION,
        os: describeOs(),
        playwrightVersion,
      });
    });

    socket.on('message', (raw) => {
      const message = decodeMessage<ServerToAgentMessage>(raw.toString());
      if (!message) return;

      if (message.type === 'server.welcome') {
        this.log(`Baglandi: ${message.agentName} (sunucu ${message.serverVersion})`);
        this.startHeartbeat(message.heartbeatIntervalMs);
        return;
      }
      if (message.type === 'server.reject') {
        // A rejection is a configuration problem, not a network blip. Retrying
        // in a loop would only spam the log, so stop and tell the analyst.
        this.log(`Sunucu baglantiyi reddetti: ${message.message}`);
        this.stopped = true;
        socket.close(1000, 'rejected');
        process.exitCode = 1;
        return;
      }
      for (const handler of this.handlers) handler(message);
    });

    socket.on('close', (code) => {
      this.clearHeartbeat();
      if (this.stopped) return;
      this.log(`Baglanti kesildi (kod ${code}), ${Math.round(this.reconnectDelayMs / 1000)} sn sonra tekrar denenecek.`);
      setTimeout(() => void this.connect(), this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    });

    socket.on('error', (error: Error) => {
      // 'close' always follows, which is where the retry is scheduled.
      this.log(`Baglanti hatasi: ${error.message}`);
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ type: 'agent.heartbeat', activeSessionIds: this.activeSessions() });
    }, intervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
