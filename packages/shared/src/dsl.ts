/**
 * The test DSL. This is the single source of truth for a scenario: the recorder
 * produces it, the UI edits it, the runner interprets it. No .spec.ts files.
 *
 * A step points at a *variable*, never at a literal value. That is what makes
 * "Müşteri Oluşturma" runnable with the Ahmet data set and the Mehmet data set
 * without touching the scenario.
 */

export const STEP_TYPES = [
  'navigate',
  'click',
  'dblclick',
  'fill',
  'press',
  'select',
  'check',
  'uncheck',
  'upload',
  'assertVisible',
  'assertText',
  'assertValue',
] as const;

export type StepType = (typeof STEP_TYPES)[number];

/**
 * Step types whose value can come from a data set.
 *
 * Assertions are included on purpose: the expected result usually differs per
 * data set too. "Kayıt başarılı: Ahmet Yılmaz" and "…Mehmet Kaya" are the same
 * assertion with different data, so the expected text belongs in the data set
 * rather than forcing two near-identical scenarios.
 */
export const PARAMETERISABLE_STEP_TYPES: readonly StepType[] = [
  'fill',
  'select',
  'upload',
  'assertText',
  'assertValue',
];

export const VARIABLE_TYPES = ['text', 'number', 'date', 'file', 'select'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface StepTarget {
  /** Playwright selector as emitted by the recorder, e.g. internal:role=button[name="Kaydet"i] */
  selector: string;
  /** Human-readable form shown in the UI, e.g. getByRole('button', { name: 'Kaydet' }) */
  label: string;
  pageAlias: string;
  /** Recorder emits this; unused until iframe support lands. */
  framePath?: string[];
}

export interface StepOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: string[];
  key?: string;
  timeoutMs?: number;
}

export interface TestStepDsl {
  id: string;
  order: number;
  type: StepType;
  enabled: boolean;
  /** Absent only for `navigate`. */
  target?: StepTarget;
  /** A literal, or a binding of the form `{{variableKey}}`. */
  value?: string;
  /** What the analyst actually typed while recording. Documentation only. */
  recordedValue?: string;
  options?: StepOptions;
}

export interface VariableDsl {
  id: string;
  key: string;
  displayName?: string;
  type: VariableType;
  required: boolean;
  defaultValue?: string;
}

export interface ScenarioDsl {
  id: string;
  name: string;
  baseUrl: string;
  status: 'draft' | 'ready' | 'archived';
  variables: VariableDsl[];
  steps: TestStepDsl[];
}

// ---------------------------------------------------------------------------
// Variable binding
// ---------------------------------------------------------------------------

const BINDING_RE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

export function toBinding(variableKey: string): string {
  return `{{${variableKey}}}`;
}

/** Returns the variable key if `value` is exactly one binding, else null. */
export function parseBinding(value: string | undefined): string | null {
  if (!value) return null;
  const match = BINDING_RE.exec(value);
  return match?.[1] ?? null;
}

/** Suggests a variable key from an accessible name: "Müşteri Adı" -> "musteriAdi". */
export function suggestVariableKey(label: string): string {
  const map: Record<string, string> = {
    ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
    ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
  };
  const ascii = label.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => map[ch] ?? ch);
  const words = ascii
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'value';
  const [first, ...rest] = words;
  return (
    (first ?? 'value').toLowerCase() +
    rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  );
}
