import { router, useLocalSearchParams } from 'expo-router';
import { Battery, Car, Cog, Disc3, Fuel, LocateFixed, Phone, TriangleAlert, Truck, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { api } from '@/api';
import { errorMessage, isNetworkError } from '@/api/errors';
import { Button, Grid, haptic, InlineNotice, Row, Screen, Text, Tile } from '@/components';
import { useConfig, useVehicles } from '@/hooks/queries';
import { useOnline } from '@/hooks/use-online';
import { callPhone, getCurrentFix, LocationPermissionError, openSettings, type Fix } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { sosQueue } from '@/services/sos-queue';
import { useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Font, Radius, Space, useColors } from '@/theme';

// Owner screen for sending an emergency SOS.

// Icon per breakdown type; unknown issues fall back to the warning triangle.
const ISSUE_ICONS: Record<string, LucideIcon> = {
  'Flat Tire': Disc3,
  'Dead Battery': Battery,
  'Engine Failure': Cog,
  Towing: Truck,
  'Low Fuel': Fuel,
  'Car Crash': TriangleAlert,
};

/** Progress of getting the owner's GPS position. */
type GpsState ={ kind: 'locating' } | { kind: 'locked'; fix: Fix } | { kind: 'denied' } | { kind: 'error'; message: string };

/**
 * O2 SOS — choose vehicle + 1 of 6 issues; tap sends immediately (≤ 3 taps from launch).
 * GPS starts locating as soon as the screen opens. Without signal, the SOS is queued and sent later.
 */
export default function SosIssue() {
  const c = useColors();
  const user = useUser();
  const config = useConfig();
  const online = useOnline();
  const vehicles = useVehicles();
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const [picked, setVehicleId] = useState<number | null>(params.vehicleId ? Number(params.vehicleId) : null);
  const [gps, setGps] = useState<GpsState>({ kind: 'locating' });
  const [sending, setSending] = useState<string | null>(null);
  // The vehicle is preselected (first car) unless the owner picks another.
  const vehicleId = picked ?? vehicles.data?.[0]?.id ?? null;

  // Bumping `attempt` re-runs the GPS effect below ("Retry GPS").
  const [attempt, setAttempt] = useState(0);
  const locate = () => {
    setGps({ kind: 'locating' });
    setAttempt((a) => a + 1);
  };

  // Get a GPS fix; `active` ignores a result that arrives after leaving the screen or retrying.
  useEffect(() => {
    let active = true;
    getCurrentFix().then(
      (fix) => active && setGps({ kind: 'locked', fix }),
      (e) => active && setGps(e instanceof LocationPermissionError ? { kind: 'denied' } : { kind: 'error', message: errorMessage(e) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const vehicle = vehicles.data?.find((v) => v.id === vehicleId);

  // Sends the SOS for the tapped issue. Offline (or if the request can't reach the server), it's saved
  // to the queue and the offline screen is shown instead.
  const send = async (issue: string) => {
    if (!vehicle || !user) return;
    if (gps.kind !== 'locked') {
      toast({ title: 'Waiting for GPS', body: 'We need your location to send help. Tap "Retry GPS".', tone: 'warning' });
      return;
    }
    haptic('warning');
    const input = { vehicleId: vehicle.id, issue, lat: gps.fix.lat, lng: gps.fix.lng };
    if (!online) {
      await sosQueue.set({ ...input, queuedAt: new Date().toISOString(), vehicleLabel: `${vehicle.make} ${vehicle.model}`, plate: vehicle.plateNumber, userId: user.id });
      router.replace('/sos/offline');
      return;
    }
    setSending(issue);
    try {
      // REST (POST /sos) so it survives socket reconnects.
      const res = await api.sendSos(input);
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      router.replace({ pathname: '/sos/[id]', params: { id: String(res.jobId), nearby: String(res.nearbyCount), eta: res.eta } });
    } catch (e) {
      if (isNetworkError(e)) {
        await sosQueue.set({ ...input, queuedAt: new Date().toISOString(), vehicleLabel: `${vehicle.make} ${vehicle.model}`, plate: vehicle.plateNumber, userId: user.id });
        router.replace('/sos/offline');
      } else {
        toast({ title: 'SOS not sent', body: errorMessage(e), tone: 'danger' });
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <Screen
      back
      title="Emergency SOS"
      footer={
        <Text center variant="bodyStrong" tone="textMuted">
          Help is one tap away
        </Text>
      }>
      <Text variant="label">Vehicle</Text>
      {vehicles.data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm }}>
          {vehicles.data.map((v) => {
            const active = v.id === vehicleId;
            return (
              <Pressable
                key={v.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setVehicleId(v.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Space.sm,
                  paddingHorizontal: Space.md,
                  minHeight: 52,
                  borderRadius: Radius.button,
                  borderWidth: 1.5,
                  borderColor: active ? c.danger : c.border,
                  backgroundColor: active ? c.dangerSoft : c.surface,
                }}>
                <Car size={20} color={active ? c.danger : c.textMuted} />
                <View>
                  <Text variant="bodyStrong">
                    {v.make} {v.model}
                  </Text>
                  <Text variant="caption">{v.plateNumber}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Button title="Add a car first" kind="outline" onPress={() => router.push({ pathname: '/vehicle/add', params: { then: '/sos' } })} />
      )}

      <Text variant="label" style={{ marginTop: Space.md }}>
        What happened?
      </Text>
      <Grid>
        {config.sosIssues.map((issue) => (
          <Tile
            key={issue}
            icon={ISSUE_ICONS[issue] ?? TriangleAlert}
            label={issue === 'Flat Tire' ? 'Flat Tyre' : issue}
            tone="danger"
            selected={sending === issue}
            disabled={!!sending || !vehicle}
            onPress={() => send(issue)}
          />
        ))}
      </Grid>

      {gps.kind === 'locating' ? (
        <Row gap={Space.sm}>
          <ActivityIndicator color={c.danger} />
          <Text tone="textMuted">Getting your GPS location…</Text>
        </Row>
      ) : gps.kind === 'locked' ? (
        <Row gap={Space.sm}>
          <LocateFixed size={18} color={c.success} />
          <Text style={{ fontFamily: Font.semibold, color: c.success }}>
            GPS locked{gps.fix.accuracy != null ? ` · ${Math.round(gps.fix.accuracy)} m` : ''}
          </Text>
          {!online ? <Text variant="caption"> · offline — SOS will be queued</Text> : null}
        </Row>
      ) : (
        <View style={{ gap: Space.sm }}>
          <InlineNotice tone="warning">
            {gps.kind === 'denied'
              ? 'Location is off. MyCarRepair uses your location to send help to exactly where you are.'
              : gps.message}
          </InlineNotice>
          <Row gap={Space.sm}>
            {gps.kind === 'denied' ? <Button title="Open settings" kind="outline" size="md" onPress={openSettings} style={{ flex: 1 }} /> : null}
            <Button title="Retry GPS" kind="outline" size="md" onPress={locate} style={{ flex: 1 }} />
          </Row>
        </View>
      )}
      <Button title="Call emergency line" kind="secondary" icon={Phone} onPress={() => callPhone(config.supportPhone)} />
    </Screen>
  );
}
