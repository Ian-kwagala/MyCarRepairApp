import { useQuery } from '@tanstack/react-query';

import { api } from '@/api';
import { qk } from '@/hooks/queries';
import type { Job } from '@/models';
import { queryClient } from '@/services/query-client';

/** Finds a quote and its job. Push payloads carry only IDs (§8); the job is re-fetched. */
export function useQuoteWithJob(quoteId: number, jobIdHint?: number) {
  return useQuery({
    queryKey: ['quote', quoteId, jobIdHint ?? null],
    queryFn: async () => {
      const find = (job: Job) => job.quotes?.find((q) => q.id === quoteId);
      if (jobIdHint) {
        const job = await api.getJob(jobIdHint);
        queryClient.setQueryData(qk.job(job.id), job);
        const quote = find(job);
        if (quote) return { job, quote };
      }
      const active = await api.listJobs('active');
      for (const j of active) {
        const quote = find(j);
        if (quote) return { job: await api.getJob(j.id), quote };
      }
      for (const j of active) {
        const full = await api.getJob(j.id);
        const quote = find(full);
        if (quote) return { job: full, quote };
      }
      throw new Error('This quote is no longer available.');
    },
  });
}
