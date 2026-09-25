/** Environment configuration (secrets come from the environment, never the repo — §6 task 9). */
function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://postgres@127.0.0.1:5433/mycarrepair'),
  /** Use DATABASE_SSL=true for managed Postgres that requires TLS (Render, Supabase, Neon…). */
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '24h',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 30),
  /** Public base URL used in media and receipt links. Falls back to the request's host. */
  publicUrl: (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL)?.replace(/\/+$/, '') ?? null,
  /** Comma-separated CORS allow-list for the web preview; '*' allows any origin (bearer tokens, no cookies). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  /** Password for the /admin page (mechanic approval, reset codes). Admin page is disabled when unset. */
  adminPassword: process.env.ADMIN_PASSWORD ?? null,
  /** Login attempts per minute per IP (blueprint §13.1 says 5). */
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 5),
  maxUploadBytes: 5 * 1024 * 1024,
};
