import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { api } from '@/api';
import { errorMessage, isNetworkError } from '@/api/errors';
import { useOnline } from '@/hooks/use-online';
import { sosQueue } from '@/services/sos-queue';
import { useUser } from '@/store/session';
import { toast } from '@/store/toast';

/** Replays a queued offline SOS as soon as signal returns (X1 auto-retry). */
export function useSosQueueProcessor() {
  const online = useOnline();
  const user = useUser();
  const busy = useRef(false);
  useEffect(() => {
    if (!online || !user || busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        const q = await sosQueue.get();
        if (!q || q.userId !== user.id) return;
        const res = await api.sendSos({ vehicleId: q.vehicleId, issue: q.issue, lat: q.lat, lng: q.lng });
        await sosQueue.clear();
        toast({ title: 'SOS sent', body: `Alert sent to ${res.nearbyCount} nearby mechanic${res.nearbyCount === 1 ? '' : 's'}.`, tone: 'success' });
        router.replace(`/sos/${res.jobId}`);
      } catch (e) {
        if (!isNetworkError(e)) {
          await sosQueue.clear();
          toast({ title: 'Queued SOS not sent', body: errorMessage(e), tone: 'danger' });
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [online, user]);
}
