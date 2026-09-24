import { useQuery } from '@tanstack/react-query';

import { api, type EarningsRange, type JobScope, type MechanicTab } from '@/api';
import { DEFAULT_CONFIG } from '@/constants/config';
import { useUser } from '@/store/session';

export const qk = {
  config: ['config'] as const,
  me: ['me'] as const,
  vehicles: ['vehicles'] as const,
  vehicle: (id: number) => ['vehicles', id] as const,
  jobs: (scope: JobScope) => ['jobs', scope] as const,
  job: (id: number) => ['job', id] as const,
  mechanicJobs: (tab: MechanicTab) => ['mechanic', 'jobs', tab] as const,
  mechanicStats: ['mechanic', 'stats'] as const,
  earnings: (range: EarningsRange) => ['mechanic', 'earnings', range] as const,
  reviews: ['mechanic', 'reviews'] as const,
};

export function useConfig() {
  const q = useQuery({ queryKey: qk.config, queryFn: () => api.getConfig(), staleTime: 60 * 60_000 });
  return q.data ?? DEFAULT_CONFIG;
}

export function useVehicles() {
  const user = useUser();
  return useQuery({ queryKey: qk.vehicles, queryFn: () => api.listVehicles(), enabled: user?.role === 'owner' });
}

export function useVehicle(id: number) {
  return useQuery({ queryKey: qk.vehicle(id), queryFn: () => api.getVehicle(id), enabled: Number.isFinite(id) });
}

export function useJobs(scope: JobScope, opts: { live?: boolean } = {}) {
  const user = useUser();
  return useQuery({
    queryKey: qk.jobs(scope),
    queryFn: () => api.listJobs(scope),
    enabled: user?.role === 'owner',
    refetchInterval: opts.live ? 15_000 : false,
  });
}

/** Live screens poll as a safety net; real-time events invalidate immediately. */
export function useJob(id: number, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.job(id),
    queryFn: () => api.getJob(id),
    enabled: Number.isFinite(id),
    refetchInterval: opts.live ? 10_000 : false,
  });
}

export function useMechanicJobs(tab: MechanicTab, coords: { lat: number; lng: number } | null, opts: { live?: boolean } = {}) {
  const user = useUser();
  return useQuery({
    queryKey: qk.mechanicJobs(tab),
    queryFn: () => api.listMechanicJobs(tab, coords),
    enabled: user?.role === 'mechanic' && user.status === 'active',
    refetchInterval: opts.live ? 10_000 : false,
  });
}

export function useMechanicStats() {
  return useQuery({ queryKey: qk.mechanicStats, queryFn: () => api.mechanicStats() });
}

export function useEarnings(range: EarningsRange) {
  return useQuery({ queryKey: qk.earnings(range), queryFn: () => api.earnings(range) });
}

export function useMyReviews() {
  return useQuery({ queryKey: qk.reviews, queryFn: () => api.myReviews() });
}
