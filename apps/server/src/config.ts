import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/src -> repo root */
export const REPO_ROOT = path.resolve(here, '../../..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

function required(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export const SERVER_VERSION = '0.1.0';

export const config = {
  port: Number.parseInt(required('PORT', '3001'), 10),
  webOrigins: required('WEB_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  minAgentVersion: required('MIN_AGENT_VERSION', '0.1.0'),
  storageRoot: path.resolve(REPO_ROOT, required('STORAGE_ROOT', './storage')),
  heartbeatIntervalMs: 10_000,
  /** An agent is considered gone after this long without a heartbeat. */
  agentStaleAfterMs: 30_000,
} as const;

/** Sub-folders under STORAGE_ROOT. SQLite only ever stores paths relative to it. */
export const storagePaths = {
  files: 'files',
  recordings: 'recordings',
  artifacts: 'artifacts',
  /** storageState.json and friends: never served over HTTP. */
  secrets: 'secrets',
} as const;

export function absoluteStoragePath(...segments: string[]): string {
  return path.join(config.storageRoot, ...segments);
}

export function ensureStorageLayout(): void {
  for (const folder of Object.values(storagePaths)) {
    const dir = absoluteStoragePath(folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
