import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { config } from './config';

/**
 * Firebase Cloud Messaging (HTTP v1) — the only way to wake an Android app that is closed. Authenticates with
 * a service-account key (OAuth2 JWT bearer grant, RS256) and sends data messages in the format expo-notifications
 * displays itself (title / message / body JSON / channelId), so taps reach the app's notification listeners.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let account: ServiceAccount | null | undefined;
let cached: { token: string; expiresAt: number } | null = null;

function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = config.fcmServiceAccount;
  account = null;
  if (!raw) return account;
  try {
    const text = raw.startsWith('{') ? raw : raw.startsWith('/') ? readFileSync(raw, 'utf8') : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text) as ServiceAccount;
    if (!json.project_id || !json.client_email || !json.private_key) throw new Error('missing project_id, client_email or private_key');
    account = json;
  } catch (e) {
    console.error(`FCM_SERVICE_ACCOUNT is set but unusable (${(e as Error).message}); push notifications are off.`);
  }
  return account;
}

/** True when a usable Firebase service-account key is configured. */
export const fcmEnabled = () => loadAccount() !== null;

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`FCM auth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

/** One notification: the text shown, the data the app receives on tap, and the Android channel. */
export interface FcmNotice {
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: 'sos' | 'jobs';
}

/** Sends to each token; returns the tokens FCM says are dead (app uninstalled, token rotated). */
export async function sendFcm(tokens: string[], n: FcmNotice): Promise<string[]> {
  const sa = loadAccount();
  if (!sa || !tokens.length) return [];
  const bearer = await accessToken(sa);
  const url = `${config.fcmApiBase}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  const dead: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      const message = {
        token,
        // HIGH wakes the phone from Doze; an SOS is useless after a few minutes, so it isn't queued for long.
        android: { priority: 'HIGH', ttl: n.channelId === 'sos' ? '300s' : '86400s' },
        data: {
          title: n.title,
          message: n.body,
          body: JSON.stringify(n.data),
          channelId: n.channelId,
          color: n.channelId === 'sos' ? '#EF4444' : '#F97316',
          ...(typeof n.data.jobId === 'number' ? { tag: `job-${n.data.jobId}-${String(n.data.event)}` } : {}),
        },
      };
      try {
        const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
        if (res.ok) return;
        const text = await res.text();
        if (res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(text)) dead.push(token);
        else console.warn(`FCM send failed (${res.status}): ${text.slice(0, 200)}`);
      } catch (e) {
        console.warn('FCM send failed', e);
      }
    }),
  );
  return dead;
}

/** Tests only: forget the loaded key and cached access token. */
export function resetFcmForTests() {
  account = undefined;
  cached = null;
}
