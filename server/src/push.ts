import { query } from './db';
import { sendFcm } from './fcm';

/**
 * Push as a delivery channel for the same events (§8), for users with no connected socket (app in the
 * background or closed). Tokens come from POST /me/push-token: native FCM tokens (Android builds with
 * google-services.json) go straight to Firebase; Expo push tokens (EAS builds) go through Expo's service.
 */
export async function sendPush(userIds: number[], title: string, body: string, data: Record<string, unknown>, channelId: 'sos' | 'jobs') {
  if (!userIds.length) return;
  try {
    const rows = await query<{ token: string }>(`SELECT token FROM device_tokens WHERE user_id = ANY($1::int[])`, [userIds]);
    const isExpo = (t: string) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
    const expo = rows.filter((r) => isExpo(r.token)).map((r) => ({ to: r.token, title, body, data, sound: 'default', priority: 'high', channelId }));
    const native = rows.filter((r) => !isExpo(r.token)).map((r) => r.token);

    const dead = await sendFcm(native, { title, body, data, channelId });
    if (dead.length) await query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [dead]);
    if (expo.length) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(expo),
      });
    }
  } catch (e) {
    console.warn('push failed', e);
  }
}
