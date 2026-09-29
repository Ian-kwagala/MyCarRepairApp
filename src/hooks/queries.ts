// Data-fetching hooks: one TanStack Query hook per API read, with caching, background refresh and
// offline support handled by the shared query client.
import { useQuery } from '@tanstack/react-query';

import { api, type EarningsRange, type JobScope, type MechanicTab, type ProductQuery } from '@/api';
import { DEFAULT_CONFIG } from '@/constants/config';
import { useUser } from '@/store/session';

/** Cache keys for every query, so mutations and realtime events can refresh exactly the right data. */
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
  products: (query: ProductQuery) => ['shop', 'products', query] as const,
  product: (id: number) => ['shop', 'product', id] as const,
  orders: ['shop', 'orders'] as const,
  order: (id: number) => ['shop', 'orders', id] as const,
};

/** App settings from the server, refreshed hourly. Returns the defaults until loaded, so it's never empty. */
export function useConfig() {
  const q = useQuery({ queryKey: qk.config, queryFn: () => api.getConfig(), staleTime: 60 * 60_000 });
  return q.data ?? DEFAULT_CONFIG;
}

/** The owner's cars (disabled for mechanics). */
export function useVehicles() {
  const user = useUser();
  return useQuery({ queryKey: qk.vehicles, queryFn: () => api.listVehicles(), enabled: user?.role === 'owner' });
}

/** One car and its recent jobs. Waits until `id` is a valid number (e.g. parsed from the route). */
export function useVehicle(id: number) {
  return useQuery({ queryKey: qk.vehicle(id), queryFn: () => api.getVehicle(id), enabled: Number.isFinite(id) });
}

/** The owner's active or past jobs; `live` re-polls every 15 s. */
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

/**
 * One tab of the mechanic's job board, with distances from `coords`. Only runs for approved mechanics;
 * `live` re-polls every 10 s.
 */
export function useMechanicJobs(tab: MechanicTab, coords: { lat: number; lng: number } | null, opts: { live?: boolean } = {}) {
  const user = useUser();
  return useQuery({
    queryKey: qk.mechanicJobs(tab),
    queryFn: () => api.listMechanicJobs(tab, coords),
    enabled: user?.role === 'mechanic' && user.status === 'active',
    refetchInterval: opts.live ? 10_000 : false,
  });
}

/** The mechanic's dashboard numbers. */
export function useMechanicStats() {
  return useQuery({ queryKey: qk.mechanicStats, queryFn: () => api.mechanicStats() });
}

/** The mechanic's earnings for a day/week/month view. */
export function useEarnings(range: EarningsRange) {
  return useQuery({ queryKey: qk.earnings(range), queryFn: () => api.earnings(range) });
}

/** Reviews the mechanic has received. */
export function useMyReviews() {
  return useQuery({ queryKey: qk.reviews, queryFn: () => api.myReviews() });
}

/** Shop products for a section/search/car filter (owners only). Kept fresh for a minute: stock changes. */
export function useProducts(query: ProductQuery) {
  const user = useUser();
  return useQuery({ queryKey: qk.products(query), queryFn: () => api.listProducts(query), enabled: user?.role === 'owner', staleTime: 60_000 });
}

/** One shop product. Waits until `id` is a valid number (e.g. parsed from the route). */
export function useProduct(id: number) {
  return useQuery({ queryKey: qk.product(id), queryFn: () => api.getProduct(id), enabled: Number.isFinite(id) });
}

/** The owner's shop orders, newest first; `live` re-polls every 20 s (status changes also arrive by socket). */
export function useOrders(opts: { live?: boolean } = {}) {
  const user = useUser();
  return useQuery({ queryKey: qk.orders, queryFn: () => api.myOrders(), enabled: user?.role === 'owner', refetchInterval: opts.live ? 20_000 : false });
}

/** One shop order; `live` re-polls every 15 s until it's delivered or cancelled (nothing changes after that). */
export function useOrder(id: number, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.getOrder(id),
    enabled: Number.isFinite(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return opts.live && status !== 'delivered' && status !== 'cancelled' ? 15_000 : false;
    },
  });
}
