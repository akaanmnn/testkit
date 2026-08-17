import type {
  ScenarioDsl,
  StepOptions,
  StepType,
  TestStepDsl,
  VariableDsl,
  VariableType,
} from '@testkit/shared';
import { toBinding } from '@testkit/shared';

/**
 * The single place where database rows become the DSL. Everything downstream -
 * the UI, the runner, the recorder's commit step - works on the DSL only, so
 * the column layout stays an implementation detail of this file.
 *
 * Value handling, stated once so it is not re-invented per call site:
 *   recordedValue  the literal (a URL for navigate, the typed text for fill)
 *   variableId     set => the value comes from a data set at run time
 *   DSL `value`    the binding when bound, otherwise the literal
 */

type VariableRow = {
  id: string;
  key: string;
  displayName: string | null;
  type: string;
  required: boolean;
  defaultValue: string | null;
  order: number;
};

type StepRow = {
  id: string;
  order: number;
  type: string;
  enabled: boolean;
  selector: string | null;
  label: string | null;
  pageAlias: string;
  framePathJson: string | null;
  recordedValue: string | null;
  variableId: string | null;
  optionsJson: string | null;
};

type ScenarioRow = {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  variables: VariableRow[];
  steps: StepRow[];
};

/** Serialised JSON columns must never crash a read; a bad blob degrades to undefined. */
function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function toVariableDsl(row: VariableRow): VariableDsl {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName ?? undefined,
    type: row.type as VariableType,
    required: row.required,
    defaultValue: row.defaultValue ?? undefined,
  };
}

export function toStepDsl(row: StepRow, variablesById: Map<string, VariableRow>): TestStepDsl {
  const variable = row.variableId ? variablesById.get(row.variableId) : undefined;
  const value = variable ? toBinding(variable.key) : (row.recordedValue ?? undefined);

  const step: TestStepDsl = {
    id: row.id,
    order: row.order,
    type: row.type as StepType,
    enabled: row.enabled,
    value,
    recordedValue: row.recordedValue ?? undefined,
    options: parseJson<StepOptions>(row.optionsJson),
  };

  // navigate has no target; every other type does.
  if (row.selector) {
    step.target = {
      selector: row.selector,
      label: row.label ?? row.selector,
      pageAlias: row.pageAlias,
      framePath: parseJson<string[]>(row.framePathJson),
    };
  }

  return step;
}

export function toScenarioDsl(row: ScenarioRow): ScenarioDsl {
  const variablesById = new Map(row.variables.map((variable) => [variable.id, variable]));
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    status: row.status as ScenarioDsl['status'],
    variables: [...row.variables]
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map(toVariableDsl),
    steps: [...row.steps].sort((a, b) => a.order - b.order).map((step) => toStepDsl(step, variablesById)),
  };
}

/** Include clause shared by every scenario read, so shapes cannot drift. */
export const scenarioInclude = {
  steps: { orderBy: { order: 'asc' } },
  variables: { orderBy: { order: 'asc' } },
} as const;
