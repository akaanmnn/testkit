import type {
  CreateScenarioRequest,
  ScenarioDetailResponse,
  ScenarioSummary,
  StepInput,
  UpdateScenarioRequest,
  VariableInput,
} from '@testkit/shared';
import { PARAMETERISABLE_STEP_TYPES, STEP_TYPES, VARIABLE_TYPES } from '@testkit/shared';
import { prisma } from '../db/prisma.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';
import { scenarioInclude, toScenarioDsl } from './scenarioMapper.js';

const VARIABLE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Minimal row shapes used inside this service. Annotating them explicitly keeps
 * the logic readable and independent of how the client is generated.
 */
type ScenarioCountRow = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
  status: string;
  updatedAt: Date;
  _count: { steps: number; variables: number; dataSets: number };
};
type VariableLite = { id: string; key: string; type: string };
type StepLite = { id: string };

function requireText(value: unknown, field: string, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw badRequest('invalidField', `${field} alanı zorunlu.`);
  }
  return value.trim();
}

function requireUrl(value: unknown, field: string): string {
  const text = requireText(value, field);
  try {
    new URL(text);
  } catch {
    throw badRequest('invalidUrl', `${field} tam bir adres olmalı, http:// veya https:// dahil.`);
  }
  return text;
}

export const ScenarioService = {
  async list(): Promise<ScenarioSummary[]> {
    const rows = await prisma.testScenario.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { steps: true, variables: true, dataSets: true } } },
    });

    return rows.map((row: ScenarioCountRow) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      baseUrl: row.baseUrl,
      status: row.status as ScenarioSummary['status'],
      stepCount: row._count.steps,
      variableCount: row._count.variables,
      dataSetCount: row._count.dataSets,
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async get(id: string): Promise<ScenarioDetailResponse> {
    const row = await prisma.testScenario.findUnique({
      where: { id },
      include: { ...scenarioInclude, _count: { select: { dataSets: true } } },
    });
    if (!row) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');

    return {
      scenario: toScenarioDsl(row),
      dataSetCount: row._count.dataSets,
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async create(input: CreateScenarioRequest): Promise<ScenarioDetailResponse> {
    const name = requireText(input.name, 'Ad', 2);
    const baseUrl = requireUrl(input.baseUrl, 'Başlangıç adresi');

    const clash = await prisma.testScenario.findUnique({ where: { name } });
    if (clash) throw new ApiError(409, 'nameInUse', `"${name}" adlı bir senaryo zaten var.`);

    const created = await prisma.testScenario.create({
      data: { name, baseUrl, description: input.description?.trim() || null },
    });
    return this.get(created.id);
  },

  async update(id: string, input: UpdateScenarioRequest): Promise<ScenarioDetailResponse> {
    const existing = await prisma.testScenario.findUnique({ where: { id } });
    if (!existing) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = requireText(input.name, 'Ad', 2);
      const clash = await prisma.testScenario.findUnique({ where: { name } });
      if (clash && clash.id !== id) {
        throw new ApiError(409, 'nameInUse', `"${name}" adlı bir senaryo zaten var.`);
      }
      data.name = name;
    }
    if (input.baseUrl !== undefined) data.baseUrl = requireUrl(input.baseUrl, 'Başlangıç adresi');
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.status !== undefined) {
      if (!['draft', 'ready', 'archived'].includes(input.status)) {
        throw badRequest('invalidStatus', 'Durum taslak, hazır veya arşiv olabilir.');
      }
      data.status = input.status;
    }

    await prisma.testScenario.update({ where: { id }, data });
    return this.get(id);
  },

  async remove(id: string): Promise<void> {
    const existing = await prisma.testScenario.findUnique({ where: { id } });
    if (!existing) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');
    // Steps, variables, data sets and runs cascade; stored files survive on
    // purpose, since a file can be referenced by more than one data set later.
    await prisma.testScenario.delete({ where: { id } });
  },

  /**
   * Replaces the whole step list in one transaction. The UI always sends the
   * full array, which makes reordering, disabling and deleting a single
   * operation and removes any chance of a half-applied reorder.
   */
  async replaceSteps(scenarioId: string, steps: StepInput[]): Promise<ScenarioDetailResponse> {
    const scenario = await prisma.testScenario.findUnique({
      where: { id: scenarioId },
      include: { steps: true, variables: true },
    });
    if (!scenario) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');
    if (!Array.isArray(steps)) throw badRequest('invalidSteps', 'Adım listesi gönderilmedi.');

    const variablesById = new Map<string, VariableLite>(
      scenario.variables.map((v: VariableLite) => [v.id, v]),
    );
    const knownStepIds = new Set<string>(scenario.steps.map((s: StepLite) => s.id));

    const prepared = steps.map((step, index) => {
      if (!STEP_TYPES.includes(step.type)) {
        throw badRequest('invalidStepType', `${index + 1}. adım: "${step.type}" geçerli bir aksiyon türü değil.`);
      }
      if (step.id && !knownStepIds.has(step.id)) {
        throw badRequest('unknownStep', `${index + 1}. adım bu senaryoya ait değil.`);
      }
      if (step.type === 'navigate') {
        requireUrl(step.recordedValue, `${index + 1}. adımın adresi`);
      } else if (!step.selector?.trim()) {
        throw badRequest('missingSelector', `${index + 1}. adım (${step.type}) için bir hedef gerekiyor.`);
      }

      if (step.variableId) {
        const variable = variablesById.get(step.variableId);
        if (!variable) {
          throw badRequest('unknownVariable', `${index + 1}. adım başka bir senaryonun değişkenine bağlı.`);
        }
        if (!PARAMETERISABLE_STEP_TYPES.includes(step.type)) {
          throw badRequest(
            'notParameterisable',
            `${index + 1}. adım: ${step.type} aksiyonunun bir değeri yok, değişkene bağlanamaz.`,
          );
        }
        // An upload hands a path to setInputFiles; a text variable would silently
        // resolve to nonsense at run time, so refuse it here instead.
        if (step.type === 'upload' && variable.type !== 'file') {
          throw badRequest(
            'variableTypeMismatch',
            `${index + 1}. adım: dosya yükleme adımı dosya tipinde bir değişken ister, "${variable.key}" ise ${variable.type}.`,
          );
        }
        if (step.type !== 'upload' && variable.type === 'file') {
          throw badRequest(
            'variableTypeMismatch',
            `${index + 1}. adım: "${variable.key}" bir dosya değişkeni, onu yalnızca dosya yükleme adımı kullanabilir.`,
          );
        }
      }

      return {
        id: step.id,
        order: index + 1,
        type: step.type,
        enabled: step.enabled ?? true,
        selector: step.type === 'navigate' ? null : (step.selector?.trim() ?? null),
        label: step.label?.trim() || step.selector?.trim() || null,
        pageAlias: step.pageAlias?.trim() || 'page',
        recordedValue: step.recordedValue?.trim() || null,
        variableId: step.variableId ?? null,
        optionsJson: step.options ? JSON.stringify(step.options) : null,
      };
    });

    const submittedIds = new Set(prepared.map((s) => s.id).filter(Boolean) as string[]);

    await prisma.$transaction(async (tx: typeof prisma) => {
      // Order is unique per scenario, so clear the column before rewriting it;
      // otherwise a simple swap collides with itself mid-update.
      await tx.testStep.deleteMany({
        where: { scenarioId, id: { notIn: [...submittedIds] } },
      });
      for (const step of prepared) {
        await tx.testStep.updateMany({
          where: { scenarioId, id: step.id ?? '' },
          data: { order: -step.order },
        });
      }
      for (const step of prepared) {
        const { id, ...fields } = step;
        if (id) {
          await tx.testStep.update({ where: { id }, data: fields });
        } else {
          await tx.testStep.create({ data: { ...fields, scenarioId } });
        }
      }
      await tx.testScenario.update({ where: { id: scenarioId }, data: { updatedAt: new Date() } });
    });

    return this.get(scenarioId);
  },

  async addVariable(scenarioId: string, input: VariableInput): Promise<ScenarioDetailResponse> {
    const scenario = await prisma.testScenario.findUnique({
      where: { id: scenarioId },
      include: { variables: true },
    });
    if (!scenario) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');

    const key = requireText(input.key, 'Değişken adı');
    if (!VARIABLE_KEY_RE.test(key)) {
      throw badRequest(
        'invalidVariableKey',
        'Değişken adı bir harfle başlar; yalnızca harf, rakam ve alt çizgi içerir.',
      );
    }
    if (!VARIABLE_TYPES.includes(input.type)) {
      throw badRequest('invalidVariableType', `Değişken tipi şunlardan biri olmalı: ${VARIABLE_TYPES.join(', ')}.`);
    }
    if (scenario.variables.some((v: VariableLite) => v.key === key)) {
      throw new ApiError(409, 'variableKeyInUse', `Bu senaryoda "${key}" adlı bir değişken zaten var.`);
    }
    if (input.type === 'file' && input.defaultValue) {
      throw badRequest('noFileDefault', 'Dosya değişkeninin varsayılanı olamaz; dosyalar veri setinden gelir.');
    }

    await prisma.scenarioVariable.create({
      data: {
        scenarioId,
        key,
        displayName: input.displayName?.trim() || null,
        type: input.type,
        required: input.required ?? true,
        defaultValue: input.defaultValue?.trim() || null,
        order: scenario.variables.length + 1,
      },
    });
    return this.get(scenarioId);
  },

  async updateVariable(variableId: string, input: Partial<VariableInput>): Promise<ScenarioDetailResponse> {
    const variable = await prisma.scenarioVariable.findUnique({ where: { id: variableId } });
    if (!variable) throw notFound('variableNotFound', 'Bu değişken artık mevcut değil.');

    const data: Record<string, unknown> = {};
    if (input.key !== undefined) {
      const key = requireText(input.key, 'Değişken adı');
      if (!VARIABLE_KEY_RE.test(key)) {
        throw badRequest(
          'invalidVariableKey',
          'Değişken adı bir harfle başlar; yalnızca harf, rakam ve alt çizgi içerir.',
        );
      }
      const clash = await prisma.scenarioVariable.findFirst({
        where: { scenarioId: variable.scenarioId, key, NOT: { id: variableId } },
      });
      if (clash) throw new ApiError(409, 'variableKeyInUse', `Bu senaryoda "${key}" adlı bir değişken zaten var.`);
      // Renaming is safe: steps and data set values point at the id, not the key.
      data.key = key;
    }
    if (input.displayName !== undefined) data.displayName = input.displayName?.trim() || null;
    if (input.required !== undefined) data.required = input.required;
    if (input.defaultValue !== undefined) data.defaultValue = input.defaultValue?.trim() || null;
    if (input.type !== undefined) {
      if (!VARIABLE_TYPES.includes(input.type)) {
        throw badRequest('invalidVariableType', `Değişken tipi şunlardan biri olmalı: ${VARIABLE_TYPES.join(', ')}.`);
      }
      // Changing to or from `file` would leave bound steps and stored values
      // pointing at the wrong kind of data. Unbind first, deliberately.
      if (input.type !== variable.type && (input.type === 'file' || variable.type === 'file')) {
        const bound = await prisma.testStep.count({ where: { variableId } });
        if (bound > 0) {
          throw badRequest(
            'variableInUse',
            `Dosya ve metin arasında geçiş yapmadan önce "${variable.key}" değişkenini kullanan ${bound} adımın bağını kaldırın.`,
          );
        }
      }
      data.type = input.type;
    }

    await prisma.scenarioVariable.update({ where: { id: variableId }, data });
    return this.get(variable.scenarioId);
  },

  async removeVariable(variableId: string): Promise<ScenarioDetailResponse> {
    const variable = await prisma.scenarioVariable.findUnique({ where: { id: variableId } });
    if (!variable) throw notFound('variableNotFound', 'Bu değişken artık mevcut değil.');
    // Bound steps fall back to their recorded literal (variableId is set to null
    // by the relation), and data set values for it are removed with it.
    await prisma.scenarioVariable.delete({ where: { id: variableId } });
    return this.get(variable.scenarioId);
  },
};
