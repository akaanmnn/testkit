import { existsSync } from 'node:fs';
import type { ResolutionPreview, ResolutionProblem, ResolvedVariable, VariableType } from '@testkit/shared';
import { parseBinding } from '@testkit/shared';
import { absoluteStoragePath } from '../config.js';
import { prisma } from '../db/prisma.js';
import { notFound } from '../lib/errors.js';
import { scenarioInclude, toScenarioDsl } from './scenarioMapper.js';

/**
 * Scenario + data set -> the values a run will actually use.
 *
 *      Scenario + DataSet
 *              ↓
 *        VariableResolver
 *              ↓
 *          Playwright
 *
 * Two decisions worth stating, because the whole design leans on them:
 *
 * 1. Resolution order is data set, then the variable's default, then nothing.
 *    A step's `recordedValue` is never used to satisfy a variable - it is what
 *    the analyst happened to type while recording, not test data. It only
 *    applies to steps that were deliberately left unbound.
 *
 * 2. Every problem is found *before* the browser opens. A missing spreadsheet
 *    should fail as "Ahmet veri setinde belge dosyası yok", not as a Playwright
 *    timeout thirty seconds into a run.
 */
export const VariableResolver = {
  async resolve(scenarioId: string, dataSetId: string | null): Promise<ResolutionPreview> {
    const scenarioRow = await prisma.testScenario.findUnique({
      where: { id: scenarioId },
      include: scenarioInclude,
    });
    if (!scenarioRow) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');
    const scenario = toScenarioDsl(scenarioRow);

    const problems: ResolutionProblem[] = [];
    const variables: ResolvedVariable[] = [];

    const enabledSteps = scenario.steps.filter((step) => step.enabled);
    if (enabledSteps.length === 0) {
      problems.push({
        variableKey: null,
        stepOrder: null,
        code: 'noSteps',
        message: 'Bu senaryoda çalıştırılacak adım yok.',
      });
    }

    let dataSetName = '';
    const valuesByVariableId = new Map<string, { textValue: string | null; fileId: string | null }>();

    if (dataSetId) {
      const dataSet = await prisma.dataSet.findUnique({
        where: { id: dataSetId },
        include: { values: true },
      });
      if (!dataSet) throw notFound('dataSetNotFound', 'Bu veri seti artık mevcut değil.');
      dataSetName = dataSet.name;
      for (const value of dataSet.values) {
        valuesByVariableId.set(value.variableId, { textValue: value.textValue, fileId: value.fileId });
      }
    }

    // Only variables a step actually uses need a value. A declared but unused
    // variable is untidy, not a blocker, and the scenario page already says so.
    const usedKeys = new Set(
      scenario.steps.map((step) => parseBinding(step.value)).filter((key): key is string => key !== null),
    );

    for (const variable of scenario.variables) {
      if (!usedKeys.has(variable.key)) continue;

      const stored = valuesByVariableId.get(variable.id);
      const where = dataSetId ? `"${dataSetName}" veri setinde` : 'Veri seti seçilmediği için';

      if (variable.type === 'file') {
        if (!stored?.fileId) {
          problems.push({
            variableKey: variable.key,
            stepOrder: null,
            code: 'missingRequiredValue',
            message: `${where} "${variable.key}" için bir dosya yok.`,
          });
          continue;
        }
        const file = await prisma.storedFile.findUnique({ where: { id: stored.fileId } });
        const absolute = file ? absoluteStoragePath(file.relativePath) : null;
        if (!absolute || !existsSync(absolute)) {
          problems.push({
            variableKey: variable.key,
            stepOrder: null,
            code: 'fileNotOnDisk',
            message: `"${variable.key}" için kayıtlı dosya diskte bulunamadı, yeniden yükleyin.`,
          });
          continue;
        }
        variables.push({ key: variable.key, type: 'file', value: absolute, source: 'dataSet' });
        continue;
      }

      const fromDataSet = stored?.textValue;
      if (fromDataSet !== null && fromDataSet !== undefined && fromDataSet.length > 0) {
        variables.push({
          key: variable.key,
          type: variable.type as VariableType,
          value: fromDataSet,
          source: 'dataSet',
        });
        continue;
      }
      if (variable.defaultValue) {
        variables.push({
          key: variable.key,
          type: variable.type as VariableType,
          value: variable.defaultValue,
          source: 'default',
        });
        continue;
      }
      if (variable.required) {
        problems.push({
          variableKey: variable.key,
          stepOrder: null,
          code: 'missingRequiredValue',
          message: `${where} "${variable.key}" için bir değer yok.`,
        });
      }
    }

    // Steps left unbound: fine for a click, a problem for anything that types.
    for (const step of enabledSteps) {
      if (parseBinding(step.value)) continue;

      if (step.type === 'upload') {
        problems.push({
          variableKey: null,
          stepOrder: step.order,
          code: 'uploadWithoutVariable',
          message: `${step.order}. adım bir dosya yüklüyor ama hiçbir dosya değişkenine bağlı değil. Kayıt sırasında yalnızca dosya adı alınabildiği için bu adım veri setinden dosya almak zorunda.`,
        });
        continue;
      }

      const needsValue = ['navigate', 'fill', 'select', 'press', 'assertText', 'assertValue'].includes(step.type);
      if (needsValue && !step.value) {
        problems.push({
          variableKey: null,
          stepOrder: step.order,
          code: 'unboundStepWithoutValue',
          message: `${step.order}. adım (${step.type}) için bir değer yok.`,
        });
      }
    }

    return {
      scenarioId,
      dataSetId,
      runnable: problems.length === 0,
      variables,
      problems,
    };
  },

  /**
   * Substitutes `{{key}}` for a step. Phase 4's runner calls this per step, and
   * it deliberately fails loudly: reaching Playwright with an unresolved binding
   * would type the literal `{{customerName}}` into the application.
   */
  substitute(value: string | undefined, resolved: ResolvedVariable[]): string | undefined {
    if (!value) return value;
    const key = parseBinding(value);
    if (!key) return value;
    const match = resolved.find((variable) => variable.key === key);
    if (!match) throw new Error(`"${key}" değişkeni için değer çözümlenemedi.`);
    return match.value;
  },
};
