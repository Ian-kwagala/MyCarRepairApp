import type { SosInput } from '@/api';

import { Keys, kv } from './storage';

/** X1 offline SOS: queued request, replayed automatically when signal returns (§10.5). */
export interface QueuedSos extends SosInput {
  queuedAt: string;
  vehicleLabel: string;
  plate: string;
  userId: number;
}

export const sosQueue = {
  get: () => kv.get<QueuedSos | null>(Keys.sosQueue, null),
  set: (q: QueuedSos) => kv.set(Keys.sosQueue, q),
  clear: () => kv.remove(Keys.sosQueue),
};
