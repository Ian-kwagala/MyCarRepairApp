import { router, useLocalSearchParams } from 'expo-router';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { ErrorState, Screen, SkeletonList } from '@/components';
import { VehicleForm } from '@/features/vehicle-form';
import { useVehicle } from '@/hooks/queries';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';

// Owner screen for editing a saved car.

/** Loads the car, then shows the vehicle form pre-filled with its details. */
export default function EditVehicle() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useVehicle(id);
  // Loading or failed: show a placeholder screen instead of an empty form.
  if (!q.data) {
    return (
      <Screen back title="Edit vehicle">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList />}
      </Screen>
    );
  }
  return (
    <VehicleForm
      initial={q.data.vehicle}
      title="Edit vehicle"
      submitLabel="Save changes"
      onSubmit={async ({ input, newPhotos, keepPhotos }) => {
        try {
          await api.updateVehicle(id, { ...input, keepPhotos, newPhotos });
          await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          toast({ title: 'Vehicle updated', tone: 'success' });
          router.back();
        } catch (e) {
          toast({ title: 'Could not save', body: errorMessage(e), tone: 'danger' });
        }
      }}
    />
  );
}
