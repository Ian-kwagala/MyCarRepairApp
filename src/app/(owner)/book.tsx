import { router, useLocalSearchParams } from 'expo-router';
import { CircleGauge, Disc3, Droplet, Wrench, type LucideIcon } from '@/components/icons';
import { useCallback, useState } from 'react';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, DateStrip, Grid, haptic, InlineNotice, Screen, Text, TextField, Tile } from '@/components';
import { VehiclePicker } from '@/features/vehicle-picker';
import { useConfig } from '@/hooks/queries';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space } from '@/theme';
import { formatUGX, toISODate } from '@/utils/format';

// Owner screen for booking a maintenance service.

// Icon per service; services added later via server config fall back to the wrench.
const SERVICE_ICONS: Record<string, LucideIcon> = {
  'Oil Change': Droplet,
  'Brake Repair': Disc3,
  'General Service': Wrench,
  'Tyre Rotation': CircleGauge,
};

/** O7 Book maintenance — service, date strip, notes. Past dates disabled (server also rejects). */
export default function Book() {
  const config = useConfig();
  // A car can be preselected when coming from its detail page or the add-car flow.
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const [vehicleId, setVehicleId] = useState<number | null>(params.vehicleId ? Number(params.vehicleId) : null);
  const [service, setService] = useState<string | null>(null);
  const [date, setDate] = useState(toISODate(new Date()));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable callback so VehiclePicker's auto-select effect doesn't re-run every render.
  const onVehicle = useCallback((id: number) => setVehicleId(id), []);

  // Creates the booking, refreshes job lists and opens the new job.
  const submit = async () => {
    setError(null);
    if (!vehicleId) return setError('Choose a vehicle.');
    if (!service) return setError('Choose a service.');
    setLoading(true);
    try {
      const job = await api.createBooking({ vehicleId, serviceType: service, scheduledDate: date, notes: notes.trim() || undefined });
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Booking requested', body: 'We will notify you when a mechanic accepts.', tone: 'success' });
      router.replace(`/job/${job.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen back title="Book a service" footer={<Button title="Request booking" onPress={submit} loading={loading} disabled={!service || !vehicleId} />}>
      <VehiclePicker value={vehicleId} onChange={onVehicle} then="/book" />
      <Text variant="label" style={{ marginTop: Space.sm }}>
        Service
      </Text>
      <Grid>
        {config.bookingServices.map((s) => (
          <Tile key={s} icon={SERVICE_ICONS[s] ?? Wrench} label={s} selected={service === s} onPress={() => setService(s)} />
        ))}
      </Grid>
      <Text variant="label">When</Text>
      <DateStrip value={date} onChange={setDate} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Squeaking when braking…" multiline maxLength={500} />
      <Text variant="caption">
        Service fee {formatUGX(config.serviceFee)}. Any spare parts are quoted with a photo and price and only billed if you approve them.
      </Text>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
