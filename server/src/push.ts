import { query } from './db';

/**
 * Push as a delivery channel for the same events (§8): sent via the Expo push service to users with no
 * connected socket (app backgrounded or closed). Tokens are registered with POST /me/push-token.
 */
export async function sendPush(userIds: number[], title: string, body: string, data: Record<string, unknown>, channelId: 'sos' | 'jobs') {
  if (!userIds.length) return;
  const rows = await query<{ token: string }>(`SELECT token FROM device_tokens WHERE user_id = ANY($1::int[])`, [userIds]);
  const messages = rows
    .filter((r) => r.token.startsWith('ExponentPushToken[') || r.token.startsWith('ExpoPushToken['))
    .map((r) => ({ to: r.token, title, body, data, sound: 'default', priority: 'high', channelId }));
  if (!messages.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.warn('push failed', e);
  }
}
