import { router } from 'expo-router';
import { Car, Plus } from '@/components/icons';

import { Button, EmptyState, ErrorState, Screen, SkeletonList, Text, VehicleCard } from '@/components';
import { useVehicles } from '@/hooks/queries';
import { MAX_PHOTOS } from '@/constants/config';

/** O5 Virtual garage — cards with photos & service-due reminders. */
export default function Garage() {
  const vehicles = useVehicles();
  const list = vehicles.data ?? [];
  return (
    <Screen
      title="My Garage"
      eyebrow={list.length ? `${list.length} vehicle${list.length > 1 ? 's' : ''}` : undefined}
      inTabs
      refreshing={vehicles.isRefetching}
      onRefresh={() => vehicles.refetch()}
      right={list.length ? <Button title="Add" icon={Plus} size="sm" onPress={() => router.push('/vehicle/add')} /> : null}>
      {vehicles.isLoading ? (
        <SkeletonList count={2} height={96} />
      ) : vehicles.error ? (
        <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Car}
          title="Add your first car"
          body={`Save make, plate, tyre size and up to ${MAX_PHOTOS} photos so mechanics come prepared.`}
          action={<Button title="Add a car" icon={Plus} onPress={() => router.push('/vehicle/add')} />}
        />
      ) : (
        <>
          {list.map((v) => (
            <VehicleCard key={v.id} vehicle={v} onPress={() => router.push(`/vehicle/${v.id}`)} />
          ))}
          <Text variant="caption" center>
            Service due is calculated as last service + 6 months.
          </Text>
        </>
      )}
    </Screen>
  );
}
