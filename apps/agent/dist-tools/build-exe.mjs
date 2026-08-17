/**
 * Packages the agent as a single Windows executable using Node's own Single
 * Executable Application support, so the analyst receives one file to start.
 *
 * Run this on Windows with the same Node major version you want to ship:
 *   node apps/agent/dist-tools/build-exe.mjs
 *
 * What it produces in apps/agent/dist-exe/:
 *   TestKit Agent.exe            the agent
 *   testkit-agent.config.json    placeholder, replaced by the download from the UI
 *
 * Why the browser is not inside the exe: Playwright's Chromium is a separate
 * ~150 MB tree that cannot be embedded in a Node SEA blob. The agent downloads
 * it on first run instead (see ensureChromium), which keeps the handover to a
 * single file and moves the wait to a moment where the agent can explain itself.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(agentRoot, 'dist-exe');
const bundlePath = path.join(outDir, 'agent.cjs');
const blobPath = path.join(outDir, 'agent.blob');
const seaConfigPath = path.join(outDir, 'sea-config.json');
const exeName = process.platform === 'win32' ? 'TestKit Agent.exe' : 'testkit-agent';
const exePath = path.join(outDir, exeName);

const run = (file, args) => execFileSync(file, args, { stdio: 'inherit', cwd: agentRoot, shell: process.platform === 'win32' });

mkdirSync(outDir, { recursive: true });

console.log('1/4  bundling the agent');
// esbuild is not a project dependency; fetch it for the build only.
run('npx', ['--yes', 'esbuild@0.24.2', 'src/index.ts',
  '--bundle', '--platform=node', '--format=cjs', '--target=node20',
  // Playwright must stay external: it resolves its own browsers at run time and
  // reads files relative to its package, which bundling would break.
  '--external:playwright', '--external:playwright-core',
  `--outfile=${bundlePath}`]);

console.log('2/4  writing the SEA config');
writeFileSync(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useCodeCache: true,
}, null, 2));

console.log('3/4  generating the blob');
run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

console.log('4/4  injecting into a copy of node');
copyFileSync(process.execPath, exePath);
run('npx', ['--yes', 'postject@1.0.0-alpha.6', exePath, 'NODE_SEA_BLOB', blobPath,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

writeFileSync(path.join(outDir, 'testkit-agent.config.json'),
  `${JSON.stringify({ serverUrl: 'http://replace-me:3001', token: 'replace-me', agentName: 'REPLACE-ME' }, null, 2)}\n`);

console.log(`\ndone: ${exePath}`);
console.log('Ship the dist-exe folder together with node_modules/playwright, or let the agent install the browser on first run.');
