import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoredFileSummary } from '@testkit/shared';
import { absoluteStoragePath, storagePaths } from '../config.js';
import { prisma } from '../db/prisma.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';

/**
 * Uploads live on the filesystem; SQLite keeps only metadata and a relative
 * path. That is the rule for every binary in this project: a 5 MB spreadsheet
 * inside a SQLite row makes backups, diffs and memory use all worse, and gives
 * nothing back - Playwright needs a real path on disk to hand to setInputFiles.
 */

const MAX_BYTES = 25 * 1024 * 1024;

/** Keeps the analyst's file name recognisable without trusting it as a path. */
function safeName(original: string): string {
  const base = path.basename(original).replace(/[\u0000-\u001f]/g, '');
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'dosya';
}

export function toSummary(file: {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: Date;
}): StoredFileSummary {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt.toISOString(),
  };
}

export const FileService = {
  /** Moves a completed multer upload into storage and records it. */
  async ingestUpload(input: {
    tempPath: string;
    originalName: string;
    mimeType?: string;
    source?: 'upload' | 'recorder';
  }): Promise<StoredFileSummary> {
    if (!existsSync(input.tempPath)) {
      throw badRequest('uploadMissing', 'Yüklenen dosya bulunamadı, tekrar deneyin.');
    }

    const size = statSync(input.tempPath).size;
    if (size === 0) {
      unlinkSync(input.tempPath);
      throw badRequest('emptyFile', 'Dosya boş görünüyor.');
    }
    if (size > MAX_BYTES) {
      unlinkSync(input.tempPath);
      throw badRequest('fileTooLarge', `Dosya ${Math.round(MAX_BYTES / 1024 / 1024)} MB sınırını aşıyor.`);
    }

    const name = safeName(input.originalName);
    const checksum = createHash('sha256').update(await readFile(input.tempPath)).digest('hex');

    // One folder per file, named by its own id: two data sets can hold files
    // with the same name without either overwriting the other.
    const created = await prisma.storedFile.create({
      data: {
        originalName: name,
        relativePath: 'pending',
        mimeType: input.mimeType ?? null,
        sizeBytes: size,
        checksum,
        source: input.source ?? 'upload',
      },
    });

    const relativePath = path.join(storagePaths.files, created.id, name);
    const destination = absoluteStoragePath(relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(input.tempPath, destination);

    const stored = await prisma.storedFile.update({
      where: { id: created.id },
      data: { relativePath },
    });
    return toSummary(stored);
  },

  /** The absolute path a run hands to setInputFiles. */
  async absolutePath(fileId: string): Promise<string> {
    const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('fileNotFound', 'Bu dosya kayıtlı değil.');
    return absoluteStoragePath(file.relativePath);
  },

  async get(fileId: string) {
    const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('fileNotFound', 'Bu dosya kayıtlı değil.');
    return { file, absolutePath: absoluteStoragePath(file.relativePath) };
  },

  /** Refuses while a data set still points at the file, so a set cannot silently break. */
  async remove(fileId: string): Promise<void> {
    const file = await prisma.storedFile.findUnique({
      where: { id: fileId },
      include: { values: { include: { dataSet: true } } },
    });
    if (!file) throw notFound('fileNotFound', 'Bu dosya kayıtlı değil.');

    if (file.values.length > 0) {
      const names = file.values.map((v: { dataSet: { name: string } }) => v.dataSet.name).join(', ');
      throw new ApiError(409, 'fileInUse', `Bu dosya şu veri setlerinde kullanılıyor: ${names}.`);
    }

    const absolute = absoluteStoragePath(file.relativePath);
    if (existsSync(absolute)) unlinkSync(absolute);
    await prisma.storedFile.delete({ where: { id: fileId } });
  },
};
