import { useCallback, useEffect, useState } from 'react';

import type { AppNotification } from '@/models';
import { listNotifications, subscribeNotifications } from '@/services/notification-store';
import { useUser } from '@/store/session';

// Hook exposing the signed-in user's in-app notifications and unread count, kept up to date.

/**
 * The signed-in user's notifications, newest first, plus the unread count. Refreshes automatically
 * when the list changes; `reload` forces a re-read from storage.
 */
export function useNotifications() {
  const user = useUser();
  const [items, setItems] = useState<AppNotification[]>([]);
  const userId = user?.id;

  const reload = useCallback(async () => {
    const list = userId ? await listNotifications(userId) : [];
    setItems(list);
  }, [userId]);

  useEffect(() => {
    // `active` stops a slow read from overwriting the list after the user has changed or signed out.
    let active = true;
    const load = () => {
      (userId ? listNotifications(userId) : Promise.resolve([])).then((list) => active && setItems(list));
    };
    load();
    const off = subscribeNotifications((id) => {
      if (id === userId) load();
    });
    return () => {
      active = false;
      off();
    };
  }, [userId]);

  return { items, unread: items.filter((n) => !n.read).length, reload };
}
