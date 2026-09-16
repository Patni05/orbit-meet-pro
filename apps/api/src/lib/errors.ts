import { ERROR_CODES, type ErrorCode } from '@orbit/shared';
import { ZodError } from 'zod';

/**
 * One error shape for the whole API. Handlers throw `AppError`; the Fastify
 * error hook turns it into `{ error: { code, message } }`. Internal details and
 * stack traces never reach the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode | string;
  readonly details?: unknown;
  /** Safe to show to an end user verbatim. */
  readonly exposeMessage: boolean;

  constructor(
    statusCode: number,
    code: ErrorCode | string,
    message: string,
    options?: { details?: unknown; expose?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options?.details;
    this.exposeMessage = options?.expose ?? true;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, ERROR_CODES.VALIDATION, message, { details });

export const unauthorized = (message = 'You need to sign in to do that.') =>
  new AppError(401, ERROR_CODES.UNAUTHORIZED, message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);

export const notFound = (message = 'Not found.') => new AppError(404, ERROR_CODES.NOT_FOUND, message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many attempts. Please wait a moment and try again.') =>
  new AppError(429, ERROR_CODES.RATE_LIMITED, message);

export const internal = (message = 'Something went wrong on our side.', cause?: unknown) =>
  new AppError(500, ERROR_CODES.INTERNAL, message, { expose: false, cause });

export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);

/** Flattens a Zod error into `{ field: message }` for form display. */
export function zodDetails(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function fromZod(error: ZodError): AppError {
  const details = zodDetails(error);
  const first = Object.values(details)[0] ?? 'Invalid request.';
  return new AppError(400, ERROR_CODES.VALIDATION, first, { details });
}

/** Parses with a Zod schema, converting failures into a client-safe AppError. */
export function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZod(result.error);
  return result.data;
}

/**
 * Races a promise against a deadline.
 *
 * Used for dependency probes, where the useful answer to "is Redis alive?" is
 * "it did not reply in two seconds" — waiting out a TCP timeout to find that
 * out defeats the point of asking. The pending promise is left to settle on
 * its own; the caller has already stopped caring.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
