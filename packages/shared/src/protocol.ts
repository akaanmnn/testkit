/**
 * Agent <-> Server protocol.
 *
 * The agent always dials out to the server over WebSocket; the agent never
 * listens on a port. That keeps the browser out of the loop entirely (no mixed
 * content, no CORS preflight, no Local Network Access permission prompt) and
 * leaves the analyst machine without an inbound attack surface.
 *
 * The agent is deliberately dumb. It opens browsers, runs the local recorder
 * and forwards raw JSONL lines. Every interpretation of those lines happens on
 * the server, so mapping fixes ship with a server deploy instead of an agent
 * rollout on two Windows machines.
 */

export const PROTOCOL_VERSION = 1;

/** Bumped whenever the server starts requiring newer agent behaviour. */
export const MIN_AGENT_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Agent -> Server
// ---------------------------------------------------------------------------

export interface AgentHello {
  type: 'agent.hello';
  protocolVersion: number;
  token: string;
  agentName: string;
  agentVersion: string;
  os: string;
  /** Version reported by the local playwright install, or null if missing. */
  playwrightVersion: string | null;
}

export interface AgentHeartbeat {
  type: 'agent.heartbeat';
  /** Session ids the agent believes are still recording. Lets the server heal drift. */
  activeSessionIds: string[];
}

/** Phase 2. Declared now so the shape is agreed before it is implemented. */
export interface RecordingStarted {
  type: 'recording.started';
  sessionId: string;
  pid: number;
}

export interface RecordingAction {
  type: 'recording.action';
  sessionId: string;
  /** Monotonic per session, so the server can detect gaps and reorder. */
  seq: number;
  /** One raw line from `playwright codegen --target=jsonl`, unparsed. */
  rawJsonl: string;
}

export interface RecordingStopped {
  type: 'recording.stopped';
  sessionId: string;
  reason: 'user' | 'browserClosed' | 'error';
  errorMessage?: string;
}

export type AgentToServerMessage =
  | AgentHello
  | AgentHeartbeat
  | RecordingStarted
  | RecordingAction
  | RecordingStopped;

// ---------------------------------------------------------------------------
// Server -> Agent
// ---------------------------------------------------------------------------

export interface ServerWelcome {
  type: 'server.welcome';
  agentId: string;
  agentName: string;
  serverVersion: string;
  heartbeatIntervalMs: number;
}

export interface ServerReject {
  type: 'server.reject';
  reason: 'badToken' | 'protocolMismatch' | 'agentTooOld' | 'nameInUse';
  message: string;
}

/** Phase 2. */
export interface RecordingStartCommand {
  type: 'recording.start';
  sessionId: string;
  targetUrl: string;
  /** Chromium user-data-dir name, so a login survives between recordings. */
  profileName?: string;
}

export interface RecordingStopCommand {
  type: 'recording.stop';
  sessionId: string;
}

export type ServerToAgentMessage =
  | ServerWelcome
  | ServerReject
  | RecordingStartCommand
  | RecordingStopCommand;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function encodeMessage(message: AgentToServerMessage | ServerToAgentMessage): string {
  return JSON.stringify(message);
}

/** Returns null instead of throwing: a malformed frame must not kill the socket. */
export function decodeMessage<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** Semver compare limited to `major.minor.patch`. Returns true if a >= b. */
export function isVersionAtLeast(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r;
  }
  return true;
}
