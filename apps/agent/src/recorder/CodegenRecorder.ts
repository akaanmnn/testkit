import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentToServerMessage, RecordingStartCommand, RecordingStopCommand } from '@testkit/shared';
import { agentPaths, ensureAgentHome, resolvePlaywrightCli } from '../config.js';

type Send = (message: AgentToServerMessage) => void;
type Log = (message: string) => void;

interface Session {
  sessionId: string;
  child: ChildProcess;
  outputPath: string;
  /** How many JSONL lines have already been forwarded. */
  forwarded: number;
  seq: number;
  poller: NodeJS.Timeout;
  stopRequested: boolean;
}

/**
 * Runs Playwright's own recorder locally and forwards what it writes.
 *
 * This is the whole reason the agent exists: `playwright codegen` opens a real
 * Chromium on the analyst's screen, with their own file dialogs and their own
 * network access. A server-side browser could do none of that.
 *
 * The agent stays dumb on purpose - it never parses or edits an action. It
 * spawns, watches, forwards, stops.
 */
export class CodegenRecorder {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly send: Send,
    private readonly log: Log,
  ) {}

  activeSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  handle(command: RecordingStartCommand | RecordingStopCommand): void {
    if (command.type === 'recording.start') void this.start(command);
    if (command.type === 'recording.stop') void this.stop(command);
  }

  /**
   * Resolves how to launch the recorder. Preferring the bundled Playwright over
   * `npx` matters for the packaged agent: `npx` would need a network round trip
   * and a working npm on a machine where the analyst installed nothing.
   */
  private resolveCommand(): { command: string; prefixArgs: string[] } {
    const cliPath = resolvePlaywrightCli();
    if (cliPath) return { command: process.execPath, prefixArgs: [cliPath] };
    this.log('Pakete gomulu playwright bulunamadi, npx ile deneniyor.');
    return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', prefixArgs: ['playwright'] };
  }

  private async start(command: RecordingStartCommand): Promise<void> {
    if (this.sessions.has(command.sessionId)) {
      this.log(`${command.sessionId} oturumu zaten kaydediyor.`);
      return;
    }

    ensureAgentHome();
    const dir = path.join(agentPaths().recordings, command.sessionId);
    mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, 'session.jsonl');

    const { command: bin, prefixArgs } = this.resolveCommand();
    const args = [
      ...prefixArgs,
      'codegen',
      '--target=jsonl',
      `--output=${outputPath}`,
      '--browser=chromium',
    ];

    // Sign-in survives between recordings through a saved storage state, which
    // is also exactly what the server-side runner loads later. `codegen` has no
    // --user-data-dir, so this is the persistence mechanism it does support.
    if (command.profileName) {
      const profile = path.join(agentPaths().profiles, `${command.profileName}.json`);
      if (existsSync(profile)) args.push(`--load-storage=${profile}`);
      args.push(`--save-storage=${profile}`);
    }

    args.push(command.targetUrl);

    this.log(`Kayit basliyor: ${command.targetUrl}`);
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // A console window here would only confuse the analyst; the browser is the UI.
      windowsHide: true,
      env: process.env,
    });

    if (!child.pid) {
      this.send({
        type: 'recording.stopped',
        sessionId: command.sessionId,
        reason: 'error',
        errorMessage: 'Kayit programi baslatilamadi.',
      });
      return;
    }

    const session: Session = {
      sessionId: command.sessionId,
      child,
      outputPath,
      forwarded: 0,
      seq: 0,
      stopRequested: false,
      // Playwright rewrites the output file whole on every action instead of
      // appending, and fs.watch misses writes on Windows often enough to matter,
      // so a short poll is the reliable reader. Diff by line count, never tail.
      poller: setInterval(() => this.drain(command.sessionId), 400),
    };
    this.sessions.set(command.sessionId, session);

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.log(`kayit: ${text.split('\n')[0]}`);
    });

    child.on('error', (error) => {
      this.log(`Kayit baslatilamadi: ${error.message}`);
      this.finish(command.sessionId, 'error', error.message);
    });

    child.on('exit', (code) => {
      // One last read: the analyst's final action may land as the window closes.
      this.drain(command.sessionId);
      const session = this.sessions.get(command.sessionId);
      const reason = session?.stopRequested ? 'user' : code === 0 || code === null ? 'browserClosed' : 'error';
      this.finish(
        command.sessionId,
        reason,
        reason === 'error' ? `Kayit programi ${code} koduyla kapandi.` : undefined,
      );
    });

    this.send({ type: 'recording.started', sessionId: command.sessionId, pid: child.pid });
  }

  /** Forwards any lines that appeared since the last read. */
  private drain(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !existsSync(session.outputPath)) return;

    let lines: string[];
    try {
      lines = readFileSync(session.outputPath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
    } catch {
      return; // mid-rewrite; the next poll picks it up
    }

    // A shorter file means Playwright rewrote it from scratch. Resend from the
    // start rather than guessing; the server drops anything it has seen.
    if (lines.length < session.forwarded) session.forwarded = 0;

    for (let index = session.forwarded; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      session.seq += 1;
      this.send({ type: 'recording.action', sessionId, seq: session.seq, rawJsonl: line });
    }
    session.forwarded = lines.length;
  }

  private async stop(command: RecordingStopCommand): Promise<void> {
    const session = this.sessions.get(command.sessionId);
    if (!session) {
      // Already gone: tell the server anyway so its state cannot stick.
      this.send({ type: 'recording.stopped', sessionId: command.sessionId, reason: 'user' });
      return;
    }
    session.stopRequested = true;
    this.log('Kayit durduruluyor.');
    this.killTree(session.child);
  }

  /**
   * Closing the recorder means closing Chromium too. On Windows a signal does
   * not reach the browser child, which would leave an orphaned window open on
   * the analyst's desktop, so kill the whole tree there.
   */
  private killTree(child: ChildProcess): void {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3_000).unref();
    }
  }

  private finish(sessionId: string, reason: 'user' | 'browserClosed' | 'error', errorMessage?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    clearInterval(session.poller);
    this.sessions.delete(sessionId);
    this.log(`Kayit bitti (${reason}), ${session.seq} satir gonderildi.`);
    this.send({ type: 'recording.stopped', sessionId, reason, errorMessage });
  }

  /** Called on shutdown so no browser is left running. */
  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.stopRequested = true;
      clearInterval(session.poller);
      this.killTree(session.child);
    }
    this.sessions.clear();
  }
}
