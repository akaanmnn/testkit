/**
 * Verifies that `playwright codegen --target=jsonl` on the pinned Playwright
 * version still emits the shape the server-side mapper expects.
 *
 * Why this exists: `jsonl` is a real language generator inside playwright-core
 * (server/codegen/jsonl.js) but it is not listed in `codegen --help`, and the
 * CLI does not validate `--target` - it forwards the value straight to
 * `context._enableRecorder({ language })`. That is convenient and undocumented,
 * which is exactly the combination that deserves a smoke test and an exact
 * version pin in package.json.
 *
 * Findings on playwright 1.56.0, which the mapper relies on:
 *   * line 1 is a header object (browserName, launchOptions, contextOptions)
 *   * one JSON object per action afterwards
 *   * fields: name, selector, signals, pageAlias, framePath, locator{kind,body,options}
 *     plus per-action payload: text (fill), options (select), files (setInputFiles), url (navigate)
 *   * framePath IS present (the old "no framepath in JSONL" gap is closed),
 *     so iframe support later is a mapping change, not a recorder change
 *   * setInputFiles carries FILE NAMES ONLY - never a path. The browser does not
 *     expose paths to the page, which is precisely why an upload step becomes a
 *     required `file` variable resolved from the data set at run time.
 *   * select / setInputFiles selectors come from the recorder's _activeModel,
 *     which is set on mousedown. A real analyst clicks the control before using
 *     it, so this is correct in practice - but a script that drives the page
 *     through the Playwright API without a real mousedown will produce
 *     misattributed selectors. Hence: this smoke test is interactive by default.
 *
 * Usage:
 *   npm run smoke:jsonl              interactive, drive the browser yourself
 *   npm run smoke:jsonl -- --auto    non-interactive, checks plumbing only
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const auto = process.argv.includes('--auto');
const workDir = mkdtempSync(path.join(os.tmpdir(), 'testkit-smoke-'));
const pagePath = path.join(workDir, 'page.html');
const filePath = path.join(workDir, 'ahmet.xlsx');
const outputPath = path.join(workDir, 'session.jsonl');

const FIXTURE_PAGE = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>TestKit smoke</title></head>
<body style="font-family: system-ui; max-width: 32rem; margin: 3rem auto; line-height: 2">
  <h1>Müşteri Oluştur</h1>
  <label>Müşteri Adı <input id="name" type="text"></label><br>
  <label>Şehir <select id="city"><option value="34">İstanbul</option><option value="6">Ankara</option></select></label><br>
  <label>Aktif <input id="active" type="checkbox"></label><br>
  <label>Belge <input id="doc" type="file"></label><br>
  <button id="save">Kaydet</button>
  <p id="result"></p>
  <script>
    document.getElementById('save').onclick = () => {
      document.getElementById('result').textContent = 'Kayıt başarılı';
    };
  </script>
</body></html>`;

interface RecordedAction {
  name?: string;
  selector?: string;
  text?: string;
  url?: string;
  options?: string[];
  files?: string[];
  pageAlias?: string;
  framePath?: string[];
  locator?: { kind?: string; body?: string };
}

function checklist(actions: RecordedAction[]): void {
  const names = actions.map((a) => a.name).filter(Boolean) as string[];
  const withSelector = actions.filter((a) => a.selector);
  const upload = actions.find((a) => a.name === 'setInputFiles');

  const checks: Array<[string, boolean, string]> = [
    ['JSONL parses, one object per line', actions.length > 0, `${actions.length} action(s)`],
    ['navigate captured', names.includes('navigate'), names.join(', ')],
    ['pageAlias present', actions.every((a) => a.pageAlias !== undefined), 'needed for popups'],
    ['framePath present', actions.some((a) => Array.isArray(a.framePath)), 'enables iframe support later'],
    ['locator descriptor present', withSelector.some((a) => a.locator?.kind !== undefined), 'used for the readable label'],
    [
      'selectors are role/label based',
      withSelector.every((a) => (a.selector ?? '').startsWith('internal:')),
      withSelector[0]?.selector ?? 'no targeted action recorded',
    ],
  ];

  if (upload) {
    const files = upload.files ?? [];
    const looksLikeName = files.every((f) => !f.includes('/') && !f.includes('\\'));
    checks.push(['setInputFiles captured', true, JSON.stringify(files)]);
    checks.push([
      'upload carries names only (no path)',
      looksLikeName,
      'confirms uploads must come from the data set',
    ]);
  }

  console.log('');
  for (const [label, ok, note] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} ${note}`);
  }

  const failed = checks.filter(([, ok]) => !ok);
  console.log('');
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) failed. Do not bump the pinned Playwright version until the mapper is updated.`);
    process.exitCode = 1;
  } else {
    console.log('Recorder output matches what the server-side mapper expects.');
  }
  console.log(`Raw output kept at: ${outputPath}`);
}

function readActions(): RecordedAction[] {
  if (!existsSync(outputPath)) {
    console.log('No JSONL was written. Either no action was recorded, or --target=jsonl was rejected.');
    process.exitCode = 1;
    return [];
  }
  const lines = readFileSync(outputPath, 'utf8').trim().split('\n').filter(Boolean);
  const [header, ...rest] = lines;
  console.log(`\nheader: ${header}`);
  return rest.map((line) => JSON.parse(line) as RecordedAction);
}

function main(): void {
  writeFileSync(pagePath, FIXTURE_PAGE, 'utf8');
  writeFileSync(filePath, 'smoke test content', 'utf8');

  const args = ['playwright', 'codegen', '--target=jsonl', `--output=${outputPath}`, `file://${pagePath}`];

  console.log(`Running: npx ${args.join(' ')}\n`);
  if (auto) {
    console.log('--auto only checks that the process starts and writes a header; drive it by hand for a real check.');
  } else {
    console.log('In the browser that opens:');
    console.log('  1. click "Müşteri Adı" and type a name');
    console.log('  2. click "Şehir" and pick Ankara');
    console.log('  3. tick "Aktif"');
    console.log(`  4. click "Belge" and choose ${filePath}`);
    console.log('  5. click "Kaydet"');
    console.log('  6. close the browser window when you are done\n');
  }

  const child = spawn('npx', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: auto ? { ...process.env, PWTEST_CLI_HEADLESS: '1' } : process.env,
  });

  if (auto) {
    // Nothing drives the page, so give codegen time to boot and flush a header.
    setTimeout(() => child.kill('SIGTERM'), 15_000);
  }

  child.on('exit', (code) => {
    console.log(`\ncodegen exited with code ${code ?? 'null'}`);
    const actions = readActions();
    if (actions.length > 0 || !auto) checklist(actions);
  });

  child.on('error', (error) => {
    console.error(`could not start codegen: ${error.message}`);
    console.error('Is Playwright installed? Run: npx playwright install chromium');
    process.exitCode = 1;
  });
}

main();
