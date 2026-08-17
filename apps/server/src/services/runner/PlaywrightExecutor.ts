import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ResolvedVariable, StepStatus, StepType, TestStepDsl } from '@testkit/shared';
import { createLogger } from '../../lib/logger.js';
import { VariableResolver } from '../VariableResolver.js';

const log = createLogger('executor');

const DEFAULT_STEP_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

export interface StepResult {
  order: number;
  type: StepType;
  label: string | null;
  resolvedValue: string | null;
  status: StepStatus;
  durationMs: number;
  errorMessage: string | null;
  /** File name inside the run's artifact folder. */
  screenshotFile: string | null;
}

export interface ExecuteInput {
  runId: string;
  baseUrl: string;
  steps: TestStepDsl[];
  resolved: ResolvedVariable[];
  storageStatePath: string | null;
  artifactDir: string;
  headed: boolean;
  onStepStart(step: { order: number; type: StepType; label: string | null; resolvedValue: string | null }): void;
  onStepFinish(result: StepResult): void;
  isCancelled(): boolean;
}

export interface ExecuteOutcome {
  status: 'passed' | 'failed' | 'error' | 'cancelled';
  results: StepResult[];
  errorMessage: string | null;
}

/**
 * Runs a scenario by interpreting the DSL directly against the Playwright API.
 *
 * No .spec.ts file is generated. Generating code and then parsing a reporter's
 * output back into per-step results is a translation in both directions; this
 * way a step is one call, its result is one object, and the screenshot belongs to
 * it by construction. The cost is that we implement waiting and assertions
 * ourselves, which is the smaller of the two costs.
 */
export async function executeScenario(input: ExecuteInput): Promise<ExecuteOutcome> {
  mkdirSync(input.artifactDir, { recursive: true });

  const results: StepResult[] = [];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: !input.headed });
    context = await browser.newContext({
      // A login profile is just a storageState file; nothing here knows how the
      // application authenticates.
      storageState: input.storageStatePath ?? undefined,
      viewport: { width: 1440, height: 900 },
    });
    context.setDefaultTimeout(DEFAULT_STEP_TIMEOUT_MS);
    const page = await context.newPage();

    const enabled = input.steps.filter((step) => step.enabled);
    let failed = false;

    for (const step of enabled) {
      if (input.isCancelled()) {
        return { status: 'cancelled', results, errorMessage: 'Koşu iptal edildi.' };
      }

      const label = step.target?.label ?? null;

      // Once one step fails the rest are skipped rather than run against a page
      // that is no longer where the test thinks it is.
      if (failed) {
        const skipped: StepResult = {
          order: step.order,
          type: step.type,
          label,
          resolvedValue: null,
          status: 'skipped',
          durationMs: 0,
          errorMessage: null,
          screenshotFile: null,
        };
        results.push(skipped);
        input.onStepFinish(skipped);
        continue;
      }

      let resolvedValue: string | null = null;
      try {
        resolvedValue = VariableResolver.substitute(step.value, input.resolved) ?? null;
      } catch (error) {
        // Should be impossible: the preflight resolves every binding before a run
        // is queued. If it happens, say so plainly instead of typing "{{x}}".
        const result: StepResult = {
          order: step.order,
          type: step.type,
          label,
          resolvedValue: step.value ?? null,
          status: 'failed',
          durationMs: 0,
          errorMessage: (error as Error).message,
          screenshotFile: null,
        };
        results.push(result);
        input.onStepFinish(result);
        failed = true;
        continue;
      }

      input.onStepStart({ order: step.order, type: step.type, label, resolvedValue });

      const startedAt = Date.now();
      let status: StepStatus = 'passed';
      let errorMessage: string | null = null;

      try {
        await runStep(page, step, resolvedValue, input.baseUrl);
      } catch (error) {
        status = 'failed';
        errorMessage = describeError(error);
        failed = true;
      }

      // Screenshot after every step, pass or fail. An analyst reading a failure
      // needs the step before it as much as the failure itself.
      let screenshotFile: string | null = null;
      try {
        screenshotFile = `step-${String(step.order).padStart(2, '0')}.png`;
        await page.screenshot({ path: path.join(input.artifactDir, screenshotFile), fullPage: false });
      } catch {
        screenshotFile = null;
      }

      const result: StepResult = {
        order: step.order,
        type: step.type,
        label,
        resolvedValue,
        status,
        durationMs: Date.now() - startedAt,
        errorMessage,
        screenshotFile,
      };
      results.push(result);
      input.onStepFinish(result);
    }

    return {
      status: failed ? 'failed' : 'passed',
      results,
      errorMessage: failed ? (results.find((r) => r.status === 'failed')?.errorMessage ?? null) : null,
    };
  } catch (error) {
    // Launch, context or navigation failures: the run never really started.
    log.error('run could not execute', { runId: input.runId, message: (error as Error).message });
    return { status: 'error', results, errorMessage: describeError(error) };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

/** Playwright errors carry a long call log; the first lines are the useful part. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message.split('\n').filter((line) => line.trim().length > 0);
  const head = lines.slice(0, 4).join(' ');
  return head.length > 600 ? `${head.slice(0, 600)}…` : head;
}

function locate(page: Page, step: TestStepDsl): Locator {
  const selector = step.target?.selector;
  if (!selector) throw new Error(`${step.order}. adımın hedefi yok.`);
  // The recorder emits Playwright's internal selector engines (internal:role=…,
  // internal:label=…). They are registered at runtime, so page.locator accepts
  // them directly and we keep exactly the targeting the recorder chose.
  return page.locator(selector).first();
}

async function runStep(page: Page, step: TestStepDsl, value: string | null, baseUrl: string): Promise<void> {
  const timeout = step.options?.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

  switch (step.type) {
    case 'navigate': {
      const target = value ?? baseUrl;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      return;
    }
    case 'click':
      await locate(page, step).click({
        timeout,
        button: step.options?.button,
        modifiers: step.options?.modifiers as never,
      });
      return;
    case 'dblclick':
      await locate(page, step).dblclick({ timeout });
      return;
    case 'fill':
      await locate(page, step).fill(value ?? '', { timeout });
      return;
    case 'press':
      await locate(page, step).press(step.options?.key ?? value ?? 'Enter', { timeout });
      return;
    case 'select':
      // The recorder stores multiple options comma separated.
      await locate(page, step).selectOption((value ?? '').split(',').filter(Boolean), { timeout });
      return;
    case 'check':
      await locate(page, step).check({ timeout });
      return;
    case 'uncheck':
      await locate(page, step).uncheck({ timeout });
      return;
    case 'upload': {
      if (!value) throw new Error('Bu adım için veri setinden dosya gelmedi.');
      // Hidden file inputs are fine: setInputFiles does not require visibility.
      await locate(page, step).setInputFiles(value.split(',').filter(Boolean), { timeout });
      return;
    }
    case 'assertVisible':
      await locate(page, step).waitFor({ state: 'visible', timeout });
      return;
    case 'assertText': {
      const locator = locate(page, step);
      const expected = value ?? '';
      await waitUntil(
        async () => ((await locator.textContent({ timeout })) ?? '').includes(expected),
        timeout,
        async () => {
          const actual = (await locator.textContent().catch(() => null)) ?? '(metin okunamadı)';
          return `Beklenen metin "${expected}" bulunamadı. Görülen: "${actual.trim().slice(0, 120)}"`;
        },
      );
      return;
    }
    case 'assertValue': {
      const locator = locate(page, step);
      const expected = value ?? '';
      await waitUntil(
        async () => (await locator.inputValue({ timeout })) === expected,
        timeout,
        async () => {
          const actual = await locator.inputValue().catch(() => '(değer okunamadı)');
          return `Beklenen değer "${expected}" değil, "${actual}" bulundu.`;
        },
      );
      return;
    }
    default: {
      const exhaustive: never = step.type;
      throw new Error(`Desteklenmeyen adım türü: ${String(exhaustive)}`);
    }
  }
}

/**
 * Polls a condition instead of pulling in @playwright/test just for `expect`.
 * The runner is a library user, not a test runner, and one dependency for two
 * assertions is not a trade worth making.
 */
async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  describeFailure: () => Promise<string>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await condition();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() >= deadline) throw new Error(await describeFailure());
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
