import { useCallback, useEffect, useState } from 'react';

import type { AppNotification } from '@/models';
import { listNotifications, subscribeNotifications } from '@/services/notification-store';
import { useUser } from '@/store/session';

export function useNotifications() {
  const user = useUser();
  const [items, setItems] = useState<AppNotification[]>([]);
  const userId = user?.id;

  const reload = useCallback(async () => {
    const list = userId ? await listNotifications(userId) : [];
    setItems(list);
  }, [userId]);

  useEffect(() => {
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
