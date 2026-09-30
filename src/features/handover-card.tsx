// Owner side of an accepted booking: when it is, the garage, and the choice of how the car gets there. The owner
// either brings it to the garage or has the mechanic collect it from an address (typed, or filled in from GPS).
// Shown on the owner's job screen until the mechanic checks the car in.
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, haptic, InlineNotice, Row, Text, TextField, Tile } from '@/components';
import { CalendarClock, House, LocateFixed, MapPin, Navigation, Truck } from '@/components/icons';
import type { HandoverMode, Job } from '@/models';
import { getCurrentFix, LocationPermissionError, openMapsSearch, reverseGeocode } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { formatDate } from '@/utils/format';
import { bookingDay } from '@/utils/jobs';

/** "today", "tomorrow" or "Fri 3 Oct". */
function whenText(date: string) {
  const d = bookingDay(date);
  return d === 'today' ? 'today' : d === 'tomorrow' ? 'tomorrow' : formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** The accepted booking's date and garage, with the drop-off / pickup choice (changeable until check-in). */
export function HandoverCard({ job }: { job: Job }) {
  const c = useColors();
  const current = job.handover ?? null;
  const [editing, setEditing] = useState(!current);
  const [mode, setMode] = useState<HandoverMode | null>(current?.mode ?? null);
  const [address, setAddress] = useState(current?.pickupAddress ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    current?.pickupLat != null && current.pickupLng != null ? { lat: current.pickupLat, lng: current.pickupLng } : null,
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const garage = job.mechanic?.garageName || job.mechanic?.fullName || 'the garage';
  const garageWhere = job.mechanic?.garageLocation;
  const day = job.scheduledDate ? bookingDay(job.scheduledDate) : null;

  // Fills the pickup address from where the phone is now (the owner is usually at home or work when booking).
  const useHere = async () => {
    setLocating(true);
    setError(null);
    try {
      const fix = await getCurrentFix();
      setPoint({ lat: fix.lat, lng: fix.lng });
      const place = await reverseGeocode(fix.lat, fix.lng);
      if (place && !address.trim()) setAddress(place);
    } catch (e) {
      setError(e instanceof LocationPermissionError ? 'Allow location to use where you are now, or type the address.' : errorMessage(e));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!mode) return;
    setError(null);
    if (mode === 'pickup' && address.trim().length < 5) return setError('Enter where the mechanic should collect the car (area, street, landmark).');
    setSaving(true);
    try {
      const updated = await api.setHandover(job.id, {
        mode,
        pickupAddress: mode === 'pickup' ? address.trim() : null,
        lat: mode === 'pickup' ? (point?.lat ?? null) : null,
        lng: mode === 'pickup' ? (point?.lng ?? null) : null,
      });
      haptic('success');
      queryClient.setQueryData(['job', job.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setEditing(false);
      toast({ title: 'Saved', body: mode === 'pickup' ? `${garage} will collect the car.` : `Bring the car to ${garage}.`, tone: 'success' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: Space.md }}>
      <Row gap={Space.sm}>
        <CalendarClock size={20} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">Booked for {job.scheduledDate ? whenText(job.scheduledDate) : 'the booked day'}</Text>
          <Text variant="caption">
            {garage}
            {garageWhere ? ` · ${garageWhere}` : ''}
          </Text>
        </View>
      </Row>
      {day === 'later' || day === 'tomorrow' ? (
        <Text variant="caption">It stays quiet until then: we’ll remind you the evening before and that morning.</Text>
      ) : null}

      {!editing && current ? (
        <View style={{ gap: Space.sm }}>
          {current.mode === 'drop_off' ? (
            <InlineNotice tone="info" icon={House}>
              You’ll bring the car to {garage}
              {garageWhere ? `, ${garageWhere}` : ''}.
            </InlineNotice>
          ) : (
            <InlineNotice tone="info" icon={Truck}>
              {garage} collects the car from {current.pickupAddress}.
            </InlineNotice>
          )}
          <Row gap={Space.sm}>
            {current.mode === 'drop_off' && garageWhere ? (
              <Button title="Directions" icon={Navigation} kind="info" size="md" style={{ flex: 1 }} onPress={() => openMapsSearch(`${garage}, ${garageWhere}`)} />
            ) : null}
            <Button title="Change" kind="ghost" size="md" style={{ flex: 1 }} onPress={() => setEditing(true)} />
          </Row>
        </View>
      ) : (
        <View style={{ gap: Space.sm }}>
          <Text variant="bodyStrong">How will the car get there?</Text>
          <Row gap={Space.sm} style={{ alignItems: 'stretch' }}>
            <View style={{ flex: 1 }}>
              <Tile icon={House} label="I'll bring it" sub={garageWhere ?? 'To the garage'} selected={mode === 'drop_off'} onPress={() => setMode('drop_off')} />
            </View>
            <View style={{ flex: 1 }}>
              <Tile icon={Truck} label="Collect my car" sub="From my address" selected={mode === 'pickup'} onPress={() => setMode('pickup')} />
            </View>
          </Row>
          {mode === 'pickup' ? (
            <>
              <TextField
                label="Pickup address"
                value={address}
                onChangeText={setAddress}
                placeholder="Area, street, landmark (e.g. Ntinda, blue gate opposite the church)"
                multiline
                maxLength={300}
                hint={point ? 'Your GPS position is attached, so the mechanic can navigate there.' : undefined}
              />
              <Button title={point ? 'Update to where I am now' : 'Use where I am now'} icon={point ? MapPin : LocateFixed} kind="outline" size="md" onPress={useHere} loading={locating} />
            </>
          ) : null}
          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          <Row gap={Space.sm}>
            {current ? <Button title="Cancel" kind="ghost" size="md" style={{ flex: 1 }} onPress={() => setEditing(false)} /> : null}
            <Button title="Confirm" size="md" style={{ flex: 1 }} onPress={save} loading={saving} disabled={!mode} />
          </Row>
        </View>
      )}
    </Card>
  );
}
