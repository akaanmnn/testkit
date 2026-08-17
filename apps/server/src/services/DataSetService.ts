import type {
  CreateDataSetRequest,
  DataSetSummary,
  DataSetValueInput,
  DataSetValueSummary,
  VariableType,
} from '@testkit/shared';
import { prisma } from '../db/prisma.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';
import { toSummary } from './FileService.js';

/**
 * Data sets hold the test data; the scenario holds only the shape. Ahmet and
 * Mehmet are two rows here, not two scenarios.
 *
 * A data set belongs to one scenario in the MVP. Everything below goes through
 * variable *ids*, so making sets shareable later means relaxing that link rather
 * than rewriting the value handling.
 */

type VariableRow = {
  id: string;
  key: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  order: number;
};

type ValueRow = {
  variableId: string;
  textValue: string | null;
  file: {
    id: string;
    originalName: string;
    mimeType: string | null;
    sizeBytes: number;
    createdAt: Date;
  } | null;
};

function buildValues(variables: VariableRow[], values: ValueRow[]): DataSetValueSummary[] {
  const byVariable = new Map(values.map((value) => [value.variableId, value]));
  return [...variables]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((variable) => {
      const value = byVariable.get(variable.id);
      return {
        variableId: variable.id,
        variableKey: variable.key,
        variableType: variable.type as VariableType,
        required: variable.required,
        textValue: value?.textValue ?? null,
        file: value?.file ? toSummary(value.file) : null,
      };
    });
}

/**
 * Which variables this set cannot satisfy. A text variable may fall back to its
 * default; a file variable cannot, because only a real file on disk can be
 * handed to the browser.
 */
function missingKeys(variables: VariableRow[], values: DataSetValueSummary[]): string[] {
  const byKey = new Map(values.map((value) => [value.variableKey, value]));
  return variables
    .filter((variable) => {
      if (!variable.required) return false;
      const value = byKey.get(variable.key);
      if (variable.type === 'file') return !value?.file;
      const text = value?.textValue ?? variable.defaultValue;
      return text === null || text === undefined || text.length === 0;
    })
    .map((variable) => variable.key);
}

const include = {
  values: { include: { file: true } },
  scenario: { include: { variables: true } },
} as const;

function toDataSetSummary(row: {
  id: string;
  scenarioId: string;
  name: string;
  notes: string | null;
  updatedAt: Date;
  values: ValueRow[];
  scenario: { variables: VariableRow[] };
}): DataSetSummary {
  const values = buildValues(row.scenario.variables, row.values);
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    name: row.name,
    notes: row.notes,
    values,
    missing: missingKeys(row.scenario.variables, values),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const DataSetService = {
  async listForScenario(scenarioId: string): Promise<DataSetSummary[]> {
    const scenario = await prisma.testScenario.findUnique({ where: { id: scenarioId } });
    if (!scenario) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');

    const rows = await prisma.dataSet.findMany({
      where: { scenarioId },
      orderBy: { name: 'asc' },
      include,
    });
    return rows.map(toDataSetSummary);
  },

  async get(dataSetId: string): Promise<DataSetSummary> {
    const row = await prisma.dataSet.findUnique({ where: { id: dataSetId }, include });
    if (!row) throw notFound('dataSetNotFound', 'Bu veri seti artık mevcut değil.');
    return toDataSetSummary(row);
  },

  async create(scenarioId: string, input: CreateDataSetRequest): Promise<DataSetSummary> {
    const scenario = await prisma.testScenario.findUnique({ where: { id: scenarioId } });
    if (!scenario) throw notFound('scenarioNotFound', 'Bu senaryo artık mevcut değil.');

    const name = (input.name ?? '').trim();
    if (name.length < 1) throw badRequest('invalidName', 'Veri setine bir ad verin, örneğin Ahmet.');

    const clash = await prisma.dataSet.findFirst({ where: { scenarioId, name } });
    if (clash) throw new ApiError(409, 'nameInUse', `Bu senaryoda "${name}" adlı bir veri seti zaten var.`);

    const created = await prisma.dataSet.create({
      data: { scenarioId, name, notes: input.notes?.trim() || null },
    });

    if (input.cloneFromId) {
      const source = await prisma.dataSet.findUnique({
        where: { id: input.cloneFromId },
        include: { values: true },
      });
      if (!source || source.scenarioId !== scenarioId) {
        throw badRequest('cloneSourceInvalid', 'Kopyalanacak veri seti bu senaryoya ait değil.');
      }
      // Files are referenced, not copied: the same spreadsheet in two sets is one
      // file on disk. Replacing it in one set only rewrites that set's reference.
      for (const value of source.values) {
        await prisma.dataSetValue.create({
          data: {
            dataSetId: created.id,
            variableId: value.variableId,
            textValue: value.textValue,
            fileId: value.fileId,
          },
        });
      }
    }

    return this.get(created.id);
  },

  async rename(dataSetId: string, input: { name?: string; notes?: string | null }): Promise<DataSetSummary> {
    const existing = await prisma.dataSet.findUnique({ where: { id: dataSetId } });
    if (!existing) throw notFound('dataSetNotFound', 'Bu veri seti artık mevcut değil.');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 1) throw badRequest('invalidName', 'Veri setine bir ad verin.');
      const clash = await prisma.dataSet.findFirst({
        where: { scenarioId: existing.scenarioId, name, NOT: { id: dataSetId } },
      });
      if (clash) throw new ApiError(409, 'nameInUse', `Bu senaryoda "${name}" adlı bir veri seti zaten var.`);
      data.name = name;
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

    await prisma.dataSet.update({ where: { id: dataSetId }, data });
    return this.get(dataSetId);
  },

  async remove(dataSetId: string): Promise<void> {
    const existing = await prisma.dataSet.findUnique({ where: { id: dataSetId } });
    if (!existing) throw notFound('dataSetNotFound', 'Bu veri seti artık mevcut değil.');
    // Values go with it; stored files stay, because another set may use them and
    // because a deleted set should not delete an analyst's uploaded document.
    await prisma.dataSet.delete({ where: { id: dataSetId } });
  },

  /** Applies a batch of values, keyed by variable name rather than row id. */
  async setValues(dataSetId: string, inputs: DataSetValueInput[]): Promise<DataSetSummary> {
    const dataSet = await prisma.dataSet.findUnique({
      where: { id: dataSetId },
      include: { scenario: { include: { variables: true } } },
    });
    if (!dataSet) throw notFound('dataSetNotFound', 'Bu veri seti artık mevcut değil.');
    if (!Array.isArray(inputs)) throw badRequest('invalidValues', 'Değer listesi gönderilmedi.');

    const byKey = new Map<string, VariableRow>(
      dataSet.scenario.variables.map((variable: VariableRow) => [variable.key, variable]),
    );

    for (const input of inputs) {
      const variable = byKey.get(input.variableKey);
      if (!variable) {
        throw badRequest('unknownVariable', `Bu senaryoda "${input.variableKey}" adlı bir değişken yok.`);
      }

      if (variable.type === 'file') {
        if (input.textValue) {
          throw badRequest(
            'expectedFile',
            `"${variable.key}" bir dosya değişkeni; metin değeri değil, dosya bekliyor.`,
          );
        }
        if (input.fileId) {
          const file = await prisma.storedFile.findUnique({ where: { id: input.fileId } });
          if (!file) throw badRequest('fileNotFound', 'Seçilen dosya kayıtlı değil, yeniden yükleyin.');
        }
      } else if (input.fileId) {
        throw badRequest(
          'expectedText',
          `"${variable.key}" metin değişkeni; dosya değil, değer bekliyor.`,
        );
      }

      const empty = variable.type === 'file' ? !input.fileId : !input.textValue;
      if (empty) {
        // Clearing a value is a normal edit, so remove the row instead of
        // storing a blank that would later read as "provided but empty".
        await prisma.dataSetValue.deleteMany({ where: { dataSetId, variableId: variable.id } });
        continue;
      }

      const existing = await prisma.dataSetValue.findFirst({
        where: { dataSetId, variableId: variable.id },
      });
      const data = {
        textValue: variable.type === 'file' ? null : (input.textValue ?? null),
        fileId: variable.type === 'file' ? (input.fileId ?? null) : null,
      };

      if (existing) {
        await prisma.dataSetValue.update({ where: { id: existing.id }, data });
      } else {
        await prisma.dataSetValue.create({ data: { dataSetId, variableId: variable.id, ...data } });
      }
    }

    await prisma.dataSet.update({ where: { id: dataSetId }, data: { updatedAt: new Date() } });
    return this.get(dataSetId);
  },
};
