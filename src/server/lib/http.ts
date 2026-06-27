import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_PUBLIC_KEY'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function created<T>(data: T): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export function fromError(err: unknown): NextResponse<ApiEnvelope<never>> {
  if (err instanceof AppError) {
    return fail(err.code, err.message, err.status, err.details);
  }
  const isZodError =
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ZodError';
  if (isZodError) {
    const zErr = err as { issues?: Array<{ path?: (string | number)[]; message?: string }> };
    const issue = zErr.issues?.[0];
    const message = issue?.message ?? 'Invalid input';
    const code: ApiErrorCode =
      message === 'INVALID_PUBLIC_KEY' ? 'INVALID_PUBLIC_KEY' : 'INVALID_INPUT';
    return fail(code, message, 400, { path: issue?.path, issues: zErr.issues });
  }
  console.error('[unhandled]', err);
  return fail('INTERNAL', 'Internal server error', 500);
}
