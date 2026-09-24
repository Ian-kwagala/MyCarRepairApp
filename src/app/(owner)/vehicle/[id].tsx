import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Pencil, Siren, Stethoscope, Trash2 } from '@/components/icons';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, Divider, ErrorState, IconButton, InlineNotice, JobListItem, Row, Screen, Section, SkeletonList, Text, VehicleThumb } from '@/components';
import { useVehicle } from '@/hooks/queries';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDate } from '@/utils/format';
import { serviceDueInDays, serviceDueText } from '@/utils/jobs';

/** Vehicle detail — specs, photos, service due, recent jobs, edit/delete. */
export default function VehicleDetail() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useVehicle(id);
  const [deleting, setDeleting] = useState(false);
  const v = q.data?.vehicle;

  const remove = async () => {
    if (!v) return;
    if (!(await confirm('Delete this car?', `${v.make} ${v.model} · ${v.plateNumber} will be removed from your garage.`, 'Delete', true))) return;
    setDeleting(true);
    try {
      await api.deleteVehicle(id);
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast({ title: 'Vehicle deleted', tone: 'info' });
      router.back();
    } catch (e) {
      toast({ title: 'Could not delete', body: errorMessage(e), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
  };

  if (!v) {
    return (
      <Screen back title="Vehicle">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList />}
      </Screen>
    );
  }

  const due = serviceDueInDays(v);
  const specs: [string, string][] = [
    ['Plate', v.plateNumber],
    ['Year', String(v.year)],
    ['Fuel', v.fuelType],
    ['Transmission', v.transmission],
    ['Tyre size', v.tyreSize ?? '—'],
    ['Colour', v.color ?? '—'],
    ['Mileage', v.mileage != null ? `${v.mileage.toLocaleString('en-US')} km` : '—'],
    ['Last service', formatDate(v.lastServiceDate)],
  ];

  return (
    <Screen
      back
      title={`${v.make} ${v.model}`}
      eyebrow={v.plateNumber}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      right={<IconButton icon={Pencil} label="Edit vehicle" onPress={() => router.push(`/vehicle/edit/${id}`)} />}>
      {v.photos.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Space.lg }}>
          {v.photos.map((p, i) => (
            <Image key={`${p}-${i}`} source={{ uri: p }} style={{ width, height: 220, backgroundColor: c.surfaceAlt }} contentFit="cover" accessibilityLabel={`Photo ${i + 1} of ${v.photos.length}`} />
          ))}
        </ScrollView>
      ) : (
        <Row style={{ justifyContent: 'center' }}>
          <VehicleThumb vehicle={v} size={120} />
        </Row>
      )}
      {serviceDueText(v) ? (
        <InlineNotice tone={due != null && due <= 14 ? 'warning' : 'success'} icon={CalendarDays}>
          {serviceDueText(v)}
        </InlineNotice>
      ) : null}
      <Card style={{ gap: Space.sm }}>
        {specs.map(([k, val], i) => (
          <View key={k}>
            {i ? <Divider /> : null}
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text tone="textMuted">{k}</Text>
              <Text variant="bodyStrong">{val}</Text>
            </Row>
          </View>
        ))}
      </Card>
      <Row gap={Space.sm}>
        <Button title="SOS" icon={Siren} kind="danger" size="md" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/sos', params: { vehicleId: String(id) } })} />
        <Button title="Book" icon={CalendarDays} size="md" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/book', params: { vehicleId: String(id) } })} />
        <Button title="Diagnose" icon={Stethoscope} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/diagnostics', params: { vehicleId: String(id) } })} />
      </Row>
      <Section title="Recent jobs">
        {q.data!.recentJobs.length ? (
          q.data!.recentJobs.map((j) => <JobListItem key={j.id} job={j} onPress={() => router.push(j.status === 'completed' ? `/job/${j.id}/receipt` : `/job/${j.id}`)} />)
        ) : (
          <Text tone="textMuted">No jobs for this car yet.</Text>
        )}
      </Section>
      <Button title="Delete vehicle" icon={Trash2} kind="ghost" onPress={remove} loading={deleting} style={{ marginTop: Space.lg }} />
    </Screen>
  );
}
