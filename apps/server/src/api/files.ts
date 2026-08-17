import { Router } from 'express';
import { param } from '../lib/http.js';
import multer from 'multer';
import { tmpdir } from 'node:os';
import { FileService } from '../services/FileService.js';
import { LoginProfileService } from '../services/LoginProfileService.js';
import { badRequest, sendError } from '../lib/errors.js';

// Uploads land in the OS temp folder first; FileService validates them and then
// moves them into storage. Nothing is written under storage/ until it is known
// to be a file worth keeping.
const upload = multer({ dest: tmpdir(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

export const filesRouter = Router();

filesRouter.post('/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw badRequest('noFile', 'Bir dosya seçin.');
    res.status(201).json(
      await FileService.ingestUpload({
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

filesRouter.get('/files/:id/download', async (req, res) => {
  try {
    const { file, absolutePath } = await FileService.get(param(req, 'id'));
    res.download(absolutePath, file.originalName);
  } catch (error) {
    sendError(res, error);
  }
});

filesRouter.delete('/files/:id', async (req, res) => {
  try {
    await FileService.remove(param(req, 'id'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Login profiles. The storageState file is uploaded but never served back: it
// carries live session cookies for the application under test.
// ---------------------------------------------------------------------------

filesRouter.get('/login-profiles', async (_req, res) => {
  try {
    res.json({ profiles: await LoginProfileService.list() });
  } catch (error) {
    sendError(res, error);
  }
});

filesRouter.post('/login-profiles', async (req, res) => {
  try {
    res.status(201).json(await LoginProfileService.create((req.body ?? {}) as { name?: string; notes?: string }));
  } catch (error) {
    sendError(res, error);
  }
});

filesRouter.post('/login-profiles/:id/storage-state', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw badRequest('noFile', 'storageState.json dosyasını seçin.');
    res.json(await LoginProfileService.attachStorageState(param(req, 'id'), req.file.path));
  } catch (error) {
    sendError(res, error);
  }
});

filesRouter.delete('/login-profiles/:id', async (req, res) => {
  try {
    await LoginProfileService.remove(param(req, 'id'));
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});
