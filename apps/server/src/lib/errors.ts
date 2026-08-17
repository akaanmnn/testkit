import type { Response } from 'express';
import type { ApiErrorBody } from '@testkit/shared';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(code: string, message: string, details?: unknown): ApiError {
  return new ApiError(400, code, message, details);
}

export function notFound(code: string, message: string): ApiError {
  return new ApiError(404, code, message);
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    res.status(error.statusCode).json(body);
    return;
  }
  const body: ApiErrorBody = {
    error: { code: 'internal', message: 'Sunucuda beklenmeyen bir hata oluştu.' },
  };
  res.status(500).json(body);
}
