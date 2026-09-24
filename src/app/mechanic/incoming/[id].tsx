import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, MapPin } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { ApiError, errorMessage } from '@/api/errors';
import { Button, haptic, Text } from '@/components';
import { INCOMING_SOS_SECONDS } from '@/constants/config';
import { setIncomingOpen, usePresence } from '@/features/mechanic-presence';
import { qk, useJob } from '@/hooks/queries';
import { reverseGeocode } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { Brand, Font, Space } from '@/theme';
import { distanceKm, etaMinutes, formatKm } from '@/utils/geo';

/** M2 Incoming SOS — full screen, 30-s countdown, vibration; "Too late" state on 409. */
export default function IncomingSos() {
  const insets = useSafeAreaInsets();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const job = useJob(id, { live: true });
  const coords = usePresence((s) => s.coords);
  const [left, setLeft] = useState(INCOMING_SOS_SECONDS);
  const [state, setState] = useState<'ringing' | 'accepting' | 'late' | 'error'>('ringing');
  const [message, setMessage] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    setIncomingOpen(true);
    if (Platform.OS !== 'web') Vibration.vibrate([0, 600, 400, 600, 400], true);
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => {
      setIncomingOpen(false);
      Vibration.cancel();
      loop.stop();
    };
  }, [pulse]);

  useEffect(() => {
    if (state !== 'ringing') return;
    const t = setTimeout(() => {
      if (left <= 1) dismiss();
      else setLeft((s) => s - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [left, state]);

  const j = job.data;
  const ownerLat = j?.owner?.locationLat;
  const ownerLng = j?.owner?.locationLng;
  useEffect(() => {
    if (ownerLat != null && ownerLng != null) void reverseGeocode(ownerLat, ownerLng).then(setPlace);
  }, [ownerLat, ownerLng]);

  // Someone else took it / owner cancelled while ringing → "Too late".
  const goneReason =
    state !== 'ringing'
      ? null
      : job.error instanceof ApiError && job.error.status === 409
        ? job.error.message
        : j && (j.status !== 'pending' || j.mechanicId != null)
          ? j.status === 'cancelled'
            ? 'The owner cancelled this request.'
            : 'Another mechanic accepted this job.'
          : null;
  const view = goneReason ? 'late' : state;
  const shownMessage = goneReason ?? message;
  useEffect(() => {
    if (goneReason) Vibration.cancel();
  }, [goneReason]);

  function dismiss() {
    Vibration.cancel();
    if (router.canGoBack()) router.back();
    else router.replace('/mechanic');
  }

  const accept = async () => {
    Vibration.cancel();
    setState('accepting');
    try {
      const accepted = await api.acceptJob(id);
      haptic('success');
      queryClient.setQueryData(qk.job(id), accepted);
      void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
      router.replace(`/mechanic/job/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setState('late');
        setMessage(e.message);
      } else {
        setState('error');
        setMessage(errorMessage(e));
      }
    }
  };

  const km = j?.distanceKm ?? (coords && ownerLat != null && ownerLng != null ? distanceKm(coords.lat, coords.lng, ownerLat, ownerLng) : null);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.center}>
        <View style={styles.bellWrap}>
          <Animated.View
            style={[
              styles.ring,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
              },
            ]}
          />
          <View style={styles.bell}>
            <BellRing size={44} color={Brand.red} />
          </View>
        </View>
        <Text variant="label" style={{ color: '#fecaca', letterSpacing: 2 }} accessibilityLiveRegion="polite">
          {view === 'late' ? 'Too late' : `Incoming SOS · ${mm}:${ss}`}
        </Text>
        <Text variant="display" center style={{ color: '#fff' }}>
          {j?.serviceType ?? '…'}
        </Text>
        {km != null ? (
          <Text style={{ color: '#fee2e2', fontFamily: Font.semibold, fontSize: 17 }}>
            {formatKm(km)} away · ≈ {etaMinutes(km)} min
          </Text>
        ) : null}
        {j ? (
          <View style={styles.details}>
            <Text style={{ color: '#fff', fontFamily: Font.bold }}>
              {j.owner?.fullName} · {j.vehicle ? `${j.vehicle.make} ${j.vehicle.model} ${j.vehicle.year}` : ''}
            </Text>
            {j.vehicle ? (
              <Text style={{ color: '#fecaca' }}>
                {[j.vehicle.tyreSize ? `Tyre ${j.vehicle.tyreSize}` : null, j.vehicle.plateNumber].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {place ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MapPin size={14} color="#fecaca" />
                <Text style={{ color: '#fecaca' }}>{place}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {shownMessage ? (
          <Text center style={{ color: '#fff', marginTop: Space.md }}>
            {shownMessage}
          </Text>
        ) : null}
      </View>
      <View style={{ padding: Space.lg, gap: Space.sm }}>
        {view === 'late' || view === 'error' ? (
          <Button title="Back to jobs" kind="onDark" onPress={dismiss} />
        ) : (
          <>
            <Button title="Accept job" kind="success" onPress={accept} loading={state === 'accepting'} disabled={!j} haptic />
            <Button title="Dismiss" kind="onDark" onPress={dismiss} disabled={state === 'accepting'} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#991b1b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.xl },
  bellWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: Space.md },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#fff' },
  bell: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  details: { alignItems: 'center', gap: 4, marginTop: Space.md, backgroundColor: 'rgba(0,0,0,0.2)', padding: Space.md, borderRadius: 16, alignSelf: 'stretch' },
});
