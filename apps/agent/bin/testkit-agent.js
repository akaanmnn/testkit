#!/usr/bin/env node
// Dev-time launcher. Phase 5 replaces this with a single Windows executable;
// keeping the CLI surface stable now means that swap changes packaging only.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.ts');
const tsx = path.join(here, '..', '..', '..', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

const child = spawn(tsx, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
