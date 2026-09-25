import { router, useLocalSearchParams, type Href } from 'expo-router';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { VehicleForm } from '@/features/vehicle-form';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';

// Owner screen for adding a car to the garage.

/**
 * O6 Add vehicle wizard. If opened with `then` (e.g. from SOS with no car saved), continues to that
 * screen with the new car selected; otherwise goes back.
 */
export default function AddVehicle() {
  const { then } = useLocalSearchParams<{ then?: string }>();
  return (
    <VehicleForm
      title="Add vehicle"
      submitLabel="Save vehicle"
      onSubmit={async ({ input, newPhotos }) => {
        try {
          const v = await api.createVehicle({ ...input, photos: newPhotos });
          await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          toast({ title: 'Vehicle added', body: `${v.make} ${v.model} · ${v.plateNumber}`, tone: 'success' });
          if (then) router.replace({ pathname: then as '/sos', params: { vehicleId: String(v.id) } } as Href);
          else router.back();
        } catch (e) {
          toast({ title: 'Could not save', body: errorMessage(e), tone: 'danger' });
        }
      }}
    />
  );
}
