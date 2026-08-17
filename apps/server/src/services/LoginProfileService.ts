import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoginProfileSummary } from '@testkit/shared';
import { absoluteStoragePath, storagePaths } from '../config.js';
import { prisma } from '../db/prisma.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';

/**
 * How a run arrives already signed in, without this project knowing anything
 * about the application's login.
 *
 * A profile is just "some way to be authenticated". Today the only kind is
 * `storageState`: the JSON Playwright writes with --save-storage, which the
 * agent produces while recording and the runner loads with newContext(). SSO,
 * MFA and expiring sessions all fit that shape, because the analyst signs in by
 * hand once in the recorder browser. If a future application needs a scripted
 * login or a token exchange, that becomes another `kind` and the runner keeps
 * calling this service the same way.
 *
 * The file holds live session cookies for the application under test, so it is
 * stored under storage/secrets and never served over HTTP.
 */
export const LoginProfileService = {
  async list(): Promise<LoginProfileSummary[]> {
    const rows = await prisma.loginProfile.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row: {
      id: string; name: string; kind: string; relativePath: string | null;
      capturedAt: Date | null; expiresAt: Date | null; notes: string | null;
    }) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as LoginProfileSummary['kind'],
      hasStorageState: Boolean(row.relativePath),
      capturedAt: row.capturedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      notes: row.notes,
    }));
  },

  async create(input: { name?: string; notes?: string }): Promise<LoginProfileSummary> {
    const name = (input.name ?? '').trim();
    if (name.length < 2) throw badRequest('invalidName', 'Profile bir ad verin, örneğin "CRM test kullanıcısı".');

    const clash = await prisma.loginProfile.findUnique({ where: { name } });
    if (clash) throw new ApiError(409, 'nameInUse', `"${name}" adlı bir oturum profili zaten var.`);

    await prisma.loginProfile.create({
      data: { name, kind: 'storageState', notes: input.notes?.trim() || null },
    });
    return (await this.list()).find((profile) => profile.name === name)!;
  },

  /** Stores a storageState captured on an analyst machine. */
  async attachStorageState(profileId: string, tempPath: string): Promise<LoginProfileSummary> {
    const profile = await prisma.loginProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw notFound('profileNotFound', 'Bu oturum profili artık mevcut değil.');
    if (!existsSync(tempPath)) throw badRequest('uploadMissing', 'Yüklenen dosya bulunamadı.');

    // Validate before storing: a wrong file here fails every run afterwards with
    // an error that points at the application rather than at this upload.
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(tempPath, 'utf8'));
    } catch {
      unlinkSync(tempPath);
      throw badRequest('invalidStorageState', 'Bu dosya geçerli bir JSON değil.');
    }
    const looksRight =
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { cookies?: unknown }).cookies);
    if (!looksRight) {
      unlinkSync(tempPath);
      throw badRequest(
        'invalidStorageState',
        'Bu dosya Playwright storageState dosyasına benzemiyor (cookies alanı yok).',
      );
    }

    const relativePath = path.join(storagePaths.secrets, profile.id, 'storageState.json');
    const destination = absoluteStoragePath(relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(tempPath, destination);

    await prisma.loginProfile.update({
      where: { id: profile.id },
      data: { relativePath, capturedAt: new Date() },
    });
    return (await this.list()).find((item) => item.id === profile.id)!;
  },

  /** What the runner needs: a path, or null to run signed out. */
  async storageStatePath(profileId: string | null): Promise<string | null> {
    if (!profileId) return null;
    const profile = await prisma.loginProfile.findUnique({ where: { id: profileId } });
    if (!profile?.relativePath) return null;
    const absolute = absoluteStoragePath(profile.relativePath);
    return existsSync(absolute) ? absolute : null;
  },

  async remove(profileId: string): Promise<void> {
    const profile = await prisma.loginProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw notFound('profileNotFound', 'Bu oturum profili artık mevcut değil.');
    if (profile.relativePath) {
      const absolute = absoluteStoragePath(profile.relativePath);
      if (existsSync(absolute)) unlinkSync(absolute);
    }
    await prisma.loginProfile.delete({ where: { id: profileId } });
  },
};
