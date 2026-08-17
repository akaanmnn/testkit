import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export const AGENT_VERSION = '0.1.0';

/**
 * Everything the agent keeps on the analyst machine lives here:
 *   config.json  - server url, pairing token, machine name
 *   profiles/    - Chromium user-data-dirs, so a login survives recordings
 *   recordings/  - local JSONL scratch files written by playwright codegen
 *
 * Nothing here is shared. The server is the only shared state.
 */
export const AGENT_HOME = path.join(os.homedir(), '.testkit');

export interface AgentConfig {
  serverUrl: string;
  token: string;
  agentName: string;
}

const CONFIG_PATH = path.join(AGENT_HOME, 'config.json');

/** The name an admin downloads from the web UI and drops beside the program. */
export const CONFIG_FILE_NAME = 'testkit-agent.config.json';

export function agentPaths() {
  return {
    home: AGENT_HOME,
    config: CONFIG_PATH,
    profiles: path.join(AGENT_HOME, 'profiles'),
    recordings: path.join(AGENT_HOME, 'recordings'),
  };
}

export function ensureAgentHome(): void {
  const paths = agentPaths();
  for (const dir of [paths.home, paths.profiles, paths.recordings]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * The folder the program itself sits in. For a packaged executable this is the
 * folder the analyst received, which is where a pre-filled config is expected.
 */
export function programDir(): string {
  // process.execPath is node during development and the .exe once packaged.
  const base = path.dirname(process.execPath);
  return /node(\.exe)?$/i.test(process.execPath) ? process.cwd() : base;
}

function readJsonIfPresent(file: string): Partial<AgentConfig> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentConfig>;
  } catch {
    return {};
  }
}

/**
 * Configuration is looked for in the order that needs the least from the
 * analyst: a file dropped next to the program, then whatever a previous `login`
 * saved, then environment overrides for development.
 *
 * The first of those is the point: an admin downloads a ready config from the
 * web UI, hands over the folder, and the analyst only double-clicks.
 */
export function loadConfig(): AgentConfig | null {
  // Nearest wins: a config beside the program beats one in the working
  // directory, which beats whatever a previous `login` saved in the home folder.
  const candidates = [
    path.join(programDir(), CONFIG_FILE_NAME),
    path.join(process.cwd(), CONFIG_FILE_NAME),
    CONFIG_PATH,
  ];
  const fromFile: Partial<AgentConfig> = {};
  for (const file of [...candidates].reverse()) Object.assign(fromFile, readJsonIfPresent(file));

  const serverUrl = process.env.TESTKIT_SERVER_URL ?? fromFile.serverUrl;
  const token = process.env.TESTKIT_AGENT_TOKEN ?? fromFile.token;
  const agentName = process.env.TESTKIT_AGENT_NAME ?? fromFile.agentName;

  if (!serverUrl || !token || !agentName) return null;
  return { serverUrl, token, agentName };
}

export function saveConfig(config: AgentConfig): void {
  ensureAgentHome();
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function describeOs(): string {
  return `${os.platform()} ${os.release()}`;
}

/**
 * Locates Playwright's own CLI entry point.
 *
 * Note the indirection: `playwright/cli.js` is NOT listed in the package's
 * `exports` map, so resolving it directly fails with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. `playwright/package.json` is exported, so
 * resolve that and walk to the sibling file.
 */
export function resolvePlaywrightCli(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

/**
 * Makes sure a Chromium is present, installing it on first run.
 *
 * This is deliberately the agent's job. Asking an analyst to open a terminal and
 * run `npx playwright install chromium` is exactly the kind of setup step this
 * program exists to remove, and the failure it prevents is a confusing one: the
 * recorder would appear to start and then die with no window.
 */
export async function ensureChromium(log: (message: string) => void): Promise<boolean> {
  const cliPath = resolvePlaywrightCli();
  if (!cliPath) {
    log('Playwright bu kurulumda bulunamadi; tarayici kontrol edilemiyor.');
    return false;
  }

  const alreadyInstalled = await new Promise<boolean>((resolve) => {
    // `install --dry-run` reports what is missing without downloading anything.
    const check = spawn(process.execPath, [cliPath, 'install', '--dry-run', 'chromium'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let output = '';
    check.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    check.on('close', () => {
      const match = /Install location:\s*(.+)/i.exec(output);
      const location = match?.[1]?.trim();
      resolve(Boolean(location && existsSync(location)));
    });
    check.on('error', () => resolve(false));
  });

  if (alreadyInstalled) return true;

  log('Ilk calistirma: kayit tarayicisi indiriliyor. Bu islem yalnizca bir kez, birkac dakika surer.');
  return new Promise<boolean>((resolve) => {
    const install = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    install.on('close', (code) => {
      if (code === 0) {
        log('Tarayici hazir.');
        resolve(true);
      } else {
        log('Tarayici indirilemedi. Internet baglantisini kontrol edip programi yeniden baslatin.');
        resolve(false);
      }
    });
    install.on('error', () => resolve(false));
  });
}

/** Reports the pinned Playwright version, or null when it is not installed. */
export async function detectPlaywrightVersion(): Promise<string | null> {
  try {
    const required = await import('playwright/package.json', { with: { type: 'json' } });
    return (required.default as { version: string }).version;
  } catch {
    return null;
  }
}
