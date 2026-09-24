/** Uniform error envelope: { error: { code, message } } (§7.1). */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  unauthorized: () => new ApiError('UNAUTHORIZED', 'Please sign in again.', 401),
  forbidden: (msg = 'You do not have access to this resource.') => new ApiError('FORBIDDEN', msg, 403),
  notFound: (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found.`, 404),
  conflict: (code: string, msg: string) => new ApiError(code, msg, 409),
  unprocessable: (code: string, msg: string) => new ApiError(code, msg, 422),
  validation: (msg: string) => new ApiError('VALIDATION_ERROR', msg, 400),
  network: () => new ApiError('NETWORK_ERROR', 'No internet connection. Check your signal and try again.', 0),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

export function isNetworkError(e: unknown) {
  return e instanceof ApiError && e.code === 'NETWORK_ERROR';
}
