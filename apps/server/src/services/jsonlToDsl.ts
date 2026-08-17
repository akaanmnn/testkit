import type { StepOptions, StepType, TestStepDsl, VariableCandidate, VariableType } from '@testkit/shared';
import { suggestVariableKey } from '@testkit/shared';

/**
 * Raw recorder output -> DSL. Lives on the server so a mapping fix ships with a
 * deploy instead of an agent rollout.
 *
 * The shape below is what `playwright codegen --target=jsonl` actually emits on
 * the pinned version; `apps/agent/src/smoke/jsonlSmoke.ts` re-checks it before
 * any version bump.
 */
export interface RawAction {
  name?: string;
  selector?: string;
  signals?: unknown[];
  text?: string;
  value?: string;
  url?: string;
  key?: string;
  options?: string[];
  files?: string[];
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: number;
  pageAlias?: string;
  framePath?: string[];
  locator?: { kind?: string; body?: string; options?: { name?: string; exact?: boolean } };
}

export function parseRawLine(line: string): RawAction | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as RawAction;
    // The first line is a header (browserName, launchOptions...) with no `name`.
    return parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

/** Rebuilds the readable form the analyst recognises: getByRole('button', ...). */
function toLabel(action: RawAction): string {
  const locator = action.locator;
  if (!locator?.kind) return action.selector ?? '';
  const name = locator.options?.name;
  switch (locator.kind) {
    case 'role':
      return name
        ? `getByRole('${locator.body ?? ''}', { name: '${name}' })`
        : `getByRole('${locator.body ?? ''}')`;
    case 'text':
      return `getByText('${locator.body ?? ''}')`;
    case 'label':
      return `getByLabel('${locator.body ?? ''}')`;
    case 'placeholder':
      return `getByPlaceholder('${locator.body ?? ''}')`;
    case 'test-id':
      return `getByTestId('${locator.body ?? ''}')`;
    default:
      return action.selector ?? '';
  }
}

/** The human-facing name of the control, used to suggest a variable key. */
function targetName(action: RawAction): string {
  return action.locator?.options?.name ?? action.locator?.body ?? action.selector ?? 'value';
}

const MODIFIER_NAMES = ['Alt', 'Control', 'Meta', 'Shift'] as const;

function toOptions(action: RawAction): StepOptions | undefined {
  const options: StepOptions = {};
  if (action.button && action.button !== 'left') options.button = action.button;
  if (action.key) options.key = action.key;
  if (typeof action.modifiers === 'number' && action.modifiers > 0) {
    options.modifiers = MODIFIER_NAMES.filter((_, index) => (action.modifiers! & (1 << index)) !== 0);
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

interface Mapped {
  type: StepType;
  value?: string;
}

/** Returns null for actions that carry no step (openPage, closePage, unknown). */
function mapType(action: RawAction): Mapped | null {
  switch (action.name) {
    case 'navigate':
      return { type: 'navigate', value: action.url };
    case 'click':
      return { type: (action.clickCount ?? 1) >= 2 ? 'dblclick' : 'click' };
    case 'fill':
      return { type: 'fill', value: action.text ?? '' };
    case 'press':
      return { type: 'press', value: action.key };
    case 'select':
      return { type: 'select', value: (action.options ?? []).join(',') };
    case 'check':
      return { type: 'check' };
    case 'uncheck':
      return { type: 'uncheck' };
    case 'setInputFiles':
      // Only file NAMES reach us; the browser never exposes paths to the page.
      // The real file comes from the data set at run time.
      return { type: 'upload', value: (action.files ?? []).join(',') };
    case 'assertVisible':
      return { type: 'assertVisible' };
    case 'assertText':
      return { type: 'assertText', value: action.text };
    case 'assertValue':
      return { type: 'assertValue', value: action.value };
    default:
      // openPage / closePage / anything new in a future Playwright version.
      return null;
  }
}

let idCounter = 0;
const nextId = () => `rec_${Date.now().toString(36)}_${(idCounter += 1)}`;

export function mapAction(action: RawAction): TestStepDsl | null {
  const mapped = mapType(action);
  if (!mapped) return null;

  // Everything except navigate needs something to act on. A recorder hiccup
  // (an action attributed before its element was hovered) would otherwise
  // become a step that fails at run time with an empty selector.
  if (mapped.type !== 'navigate' && !action.selector) return null;

  const step: TestStepDsl = {
    id: nextId(),
    order: 0,
    type: mapped.type,
    enabled: true,
    value: mapped.value,
    recordedValue: mapped.value,
    options: toOptions(action),
  };

  if (action.selector) {
    step.target = {
      selector: action.selector,
      label: toLabel(action) || action.selector,
      pageAlias: action.pageAlias ?? 'page',
      framePath: action.framePath,
    };
  }

  return step;
}

/**
 * Recorder output is faithful, not tidy: it captures the click that focused a
 * field before the typing, the Tab that left it, and one fill per keystroke
 * burst. Cleanup is deliberately conservative - it only removes things that are
 * provably redundant, because a wrongly dropped step is far worse than an extra
 * one the analyst can delete.
 */
export function cleanup(steps: TestStepDsl[]): TestStepDsl[] {
  const result: TestStepDsl[] = [];

  for (const step of steps) {
    const previous = result[result.length - 1];

    // Repeated fills on the same field: keep only the final value.
    if (
      step.type === 'fill' &&
      previous?.type === 'fill' &&
      previous.target?.selector === step.target?.selector
    ) {
      result[result.length - 1] = { ...step, id: previous.id };
      continue;
    }

    // A click that only focused the field the next step fills.
    if (previous?.type === 'click' && step.type === 'fill' && previous.target?.selector === step.target?.selector) {
      result[result.length - 1] = step;
      continue;
    }

    // Tab merely moves focus; Enter and Escape carry intent, so they stay.
    if (step.type === 'press' && step.value === 'Tab') continue;

    result.push(step);
  }

  return result.map((step, index) => ({ ...step, order: index + 1 }));
}

/**
 * Which recorded values probably change between runs. The analyst confirms or
 * rejects each one; uploads are marked mandatory because only a file name was
 * captured, so the step cannot run without a data set value.
 */
export function variableCandidates(steps: TestStepDsl[]): VariableCandidate[] {
  const candidates: VariableCandidate[] = [];
  const used = new Set<string>();

  steps.forEach((step, index) => {
    // Assertions can be bound to a variable, but a recorded assertion is usually
    // meant as a fixed expectation, so it is not proposed automatically. The
    // analyst binds it from the scenario page when the expected value varies.
    if (step.type !== 'fill' && step.type !== 'select' && step.type !== 'upload') return;

    const label = step.target?.label ?? step.target?.selector ?? `step ${index + 1}`;
    const nameSource = /'([^']+)'\s*\}\s*\)$/.exec(label)?.[1] ?? label;

    let key = suggestVariableKey(nameSource);
    if (step.type === 'upload' && !/file|dosya|belge|document/i.test(key)) key = `${key}File`;

    // Two fields called "Ad" would otherwise collide into one variable.
    let unique = key;
    let suffix = 2;
    while (used.has(unique)) unique = `${key}${suffix++}`;
    used.add(unique);

    const type: VariableType = step.type === 'upload' ? 'file' : 'text';

    candidates.push({
      stepIndex: index,
      suggestedKey: unique,
      type,
      recordedValue: step.recordedValue ?? '',
      label,
      mandatory: step.type === 'upload',
    });
  });

  return candidates;
}
