import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerForPush, requestNotificationPermission } from '@/services/notifications';
import { kv } from '@/services/storage';
import { usePrefs } from '@/store/prefs';
import { useUser } from '@/store/session';
import { confirm } from '@/utils/confirm';

/** Notifications are asked after sign-in with a pre-prompt explaining SOS alerts (§11). */
export function useNotificationSetup() {
  const user = useUser();
  const userId = user?.id;
  const role = user?.role;
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    let cancelled = false;
    const key = `mcr.notif-asked.${userId}`;
    void (async () => {
      const asked = await kv.get(key, false);
      if (!asked && !cancelled) {
        await kv.set(key, true);
        const ok = await confirm(
          'Turn on alerts?',
          role === 'mechanic'
            ? 'Get alerted about SOS jobs near you and quote decisions from owners.'
            : 'Know the moment a mechanic is on the way, when a part needs your approval, and when your car is ready.',
          'Turn on',
        );
        if (!ok) return;
      }
      if (await requestNotificationPermission()) {
        const token = await registerForPush();
        if (token) await usePrefs.getState().update({ pushToken: token });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, role]);
}
