import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

/** Uniform error envelope: { error: { code, message } } with HTTP 400/401/403/404/409/422 (§6 task 8). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const E = {
  validation: (msg: string) => new ApiError(400, 'VALIDATION_ERROR', msg),
  unauthorized: (msg = 'Please sign in again.') => new ApiError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'You do not have access to this resource.') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: string, msg: string) => new ApiError(409, code, msg),
  unprocessable: (code: string, msg: string) => new ApiError(422, code, msg),
  tooMany: (msg: string) => new ApiError(429, 'RATE_LIMITED', msg),
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid request.' } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 5 MB or smaller.' : 'Too many or invalid photos (max 5).';
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
