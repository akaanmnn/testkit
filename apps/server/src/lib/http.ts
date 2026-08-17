import type { Request } from 'express';
import { badRequest } from './errors.js';

/**
 * Reads a route parameter as a string.
 *
 * `noUncheckedIndexedAccess` types `req.params.id` as `string | undefined`, which
 * is technically right (nothing stops a handler being reused on another path) and
 * practically always present on a matched route. This makes that explicit once
 * instead of casting at every call site.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest('missingParameter', `Adreste ${name} değeri yok.`);
  }
  return value;
}
