import { Image } from 'expo-image';
import { Camera, Car, Check, ChevronRight, Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import type { ChecklistItem, Job, PartsQuote, Vehicle } from '@/models';
import { Font, Radius, Space, useColors } from '@/theme';
import { compactUGX, formatDate, formatUGX, initials } from '@/utils/format';
import { formatKm } from '@/utils/geo';
import { STAGES, serviceDueInDays, serviceDueText, stageIndex, statusLabel, statusTone, vehicleLabel } from '@/utils/jobs';

import { Card, Row } from './layout';
import { StatusPill } from './feedback';
import { Text } from './text';

/** O9 5-stage timeline: Sent · Accepted · Arrived · Fixing · Done. */
export function StageTimeline({ job }: { job: Pick<Job, 'status' | 'checklist'> }) {
  const c = useColors();
  const idx = stageIndex(job);
  return (
    <View style={styles.timeline} accessibilityLabel={`Stage ${idx + 1} of 5: ${STAGES[Math.max(0, idx)]}`}>
      {STAGES.map((s, i) => {
        const done = i <= idx;
        const current = i === idx;
        return (
          <View key={s} style={styles.stage}>
            <View style={styles.stageLine}>
              <View style={[styles.line, { backgroundColor: i === 0 ? 'transparent' : done ? c.success : c.border }]} />
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? c.success : c.surface,
                    borderColor: done ? c.success : c.border,
                    transform: [{ scale: current ? 1.2 : 1 }],
                  },
                ]}>
                {done ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
              </View>
              <View style={[styles.line, { backgroundColor: i === STAGES.length - 1 ? 'transparent' : i < idx ? c.success : c.border }]} />
            </View>
            <Text variant="caption" style={{ fontFamily: current ? Font.bold : Font.medium, color: done ? c.text : c.textSubtle }}>
              {s}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function ChecklistRow({
  item,
  onToggle,
  onPhoto,
  disabled,
}: {
  item: ChecklistItem;
  onToggle?: () => void;
  onPhoto?: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={[styles.checkRow, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.isCompleted, disabled: !onToggle || disabled }}
        accessibilityLabel={item.taskDescription}
        disabled={!onToggle || disabled}
        onPress={onToggle}
        style={styles.checkMain}>
        <View
          style={[
            styles.checkbox,
            { borderColor: item.isCompleted ? c.success : c.border, backgroundColor: item.isCompleted ? c.success : 'transparent' },
          ]}>
          {item.isCompleted ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
        </View>
        <Text style={{ flex: 1, textDecorationLine: item.isCompleted ? 'line-through' : 'none', color: item.isCompleted ? c.textMuted : c.text }}>
          {item.taskDescription}
        </Text>
      </Pressable>
      {item.photoUrl ? (
        <Image source={{ uri: item.photoUrl }} style={styles.thumb} accessibilityLabel="Task photo evidence" />
      ) : null}
      {onPhoto ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add photo proof for ${item.taskDescription}`} onPress={onPhoto} hitSlop={8} style={styles.camBtn} disabled={disabled}>
          <Camera size={20} color={c.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function QuoteStatus({ quote }: { quote: PartsQuote }) {
  if (quote.isApproved === true) return <StatusPill label="Approved" tone="success" />;
  if (quote.isApproved === false) return <StatusPill label="Declined" tone="neutral" />;
  return <StatusPill label="Waiting" tone="warning" />;
}

export function QuoteCard({ quote, onPress }: { quote: PartsQuote; onPress?: () => void }) {
  const c = useColors();
  return (
    <Card onPress={onPress} accessibilityLabel={`${quote.partName} quote ${formatUGX(quote.price)}`} style={{ padding: Space.md }}>
      <Row gap={Space.md}>
        {quote.photos[0] ? (
          <Image source={{ uri: quote.photos[0] }} style={styles.quoteImg} contentFit="cover" />
        ) : (
          <View style={[styles.quoteImg, { backgroundColor: c.surfaceAlt }]} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {quote.partName}
          </Text>
          <Text variant="heading" tone="text">
            {formatUGX(quote.price)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <QuoteStatus quote={quote} />
          {onPress && quote.isApproved === null ? (
            <Row gap={2}>
              <Text variant="bodyStrong" tone="primary">
                Review
              </Text>
              <ChevronRight size={16} color={c.primary} />
            </Row>
          ) : null}
        </View>
      </Row>
    </Card>
  );
}

export function VehicleThumb({ vehicle, size = 64 }: { vehicle: Pick<Vehicle, 'photos'>; size?: number }) {
  const c = useColors();
  return vehicle.photos[0] ? (
    <Image source={{ uri: vehicle.photos[0] }} style={{ width: size, height: size, borderRadius: 14 }} contentFit="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
      <Car size={size * 0.45} color={c.textMuted} />
    </View>
  );
}

export function VehicleCard({ vehicle, onPress, compact }: { vehicle: Vehicle; onPress?: () => void; compact?: boolean }) {
  const c = useColors();
  const due = serviceDueInDays(vehicle);
  const dueText = serviceDueText(vehicle);
  return (
    <Card onPress={onPress} accessibilityLabel={`${vehicleLabel(vehicle)} ${vehicle.plateNumber}`} style={{ padding: Space.md }}>
      <Row gap={Space.md}>
        <VehicleThumb vehicle={vehicle} size={compact ? 56 : 72} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">
            {vehicleLabel(vehicle)} {vehicle.year}
          </Text>
          <Text variant="caption">
            {vehicle.plateNumber} · {vehicle.fuelType} · {vehicle.transmission}
          </Text>
          {!compact && (vehicle.mileage != null || vehicle.tyreSize) ? (
            <Text variant="caption">
              {[vehicle.mileage != null ? `${vehicle.mileage.toLocaleString('en-US')} km` : null, vehicle.tyreSize].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {dueText ? (
            <Text variant="caption" style={{ color: due != null && due <= 14 ? c.warning : c.success, fontFamily: Font.semibold }}>
              {dueText}
            </Text>
          ) : null}
        </View>
        {onPress ? <ChevronRight size={20} color={c.textSubtle} /> : null}
      </Row>
    </Card>
  );
}

export function JobListItem({
  job,
  onPress,
  showMechanic = true,
  right,
}: {
  job: Job;
  onPress?: () => void;
  showMechanic?: boolean;
  right?: React.ReactNode;
}) {
  const c = useColors();
  const pending = (job.quotes ?? []).filter((q) => q.isApproved === null).length;
  const sub = [
    job.vehicle ? vehicleLabel(job.vehicle) : null,
    showMechanic ? job.mechanic?.fullName : job.owner?.fullName,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card onPress={onPress} accessibilityLabel={`${job.serviceType}, ${statusLabel(job.status)}`} style={{ padding: Space.md, gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {job.serviceType}
          </Text>
          {job.sosActive ? <StatusPill label="SOS" tone="danger" /> : null}
        </Row>
        {right ?? <StatusPill label={statusLabel(job.status)} tone={statusTone(job.status)} />}
      </Row>
      {sub ? <Text variant="caption">{sub}</Text> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption">
          #{job.id} · {job.scheduledDate ? `For ${formatDate(job.scheduledDate, { weekday: 'short', day: 'numeric', month: 'short' })}` : formatDate(job.createdAt)}
        </Text>
        {job.status === 'completed' ? (
          <Text variant="caption" style={{ fontFamily: Font.semibold, color: c.text }}>
            {formatUGX(job.totalPrice)}
            {job.review ? ` · ★ ${job.review.rating}` : ''}
          </Text>
        ) : job.distanceKm != null ? (
          <Text variant="caption" style={{ fontFamily: Font.semibold, color: c.text }}>
            {formatKm(job.distanceKm)}
          </Text>
        ) : pending ? (
          <Text variant="caption" style={{ fontFamily: Font.semibold, color: c.warning }}>
            {pending} quote{pending > 1 ? 's' : ''} waiting
          </Text>
        ) : null}
      </Row>
    </Card>
  );
}

export function Avatar({ name, size = 48, dark }: { name: string | null | undefined; size?: number; dark?: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: dark ? 'rgba(255,255,255,0.15)' : c.infoSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: Font.heading, fontSize: size * 0.38, color: dark ? '#fff' : c.info }}>{initials(name)}</Text>
    </View>
  );
}

export function StatTile({ value, label, dark }: { value: string; label: string; dark?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : c.surface, borderColor: dark ? 'transparent' : c.border }]}>
      <Text variant="title" style={{ color: dark ? '#fff' : c.text }}>
        {value}
      </Text>
      <Text variant="label" style={{ color: dark ? '#cbd5e1' : c.textMuted }}>
        {label}
      </Text>
    </View>
  );
}

/** SOS radar animation (O3). */
export function Radar({ color, size = 200 }: { color: string; size?: number }) {
  const [rings] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);
  useEffect(() => {
    const anims = rings.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [rings]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Searching for mechanics">
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
          }}
        />
      ))}
      <View style={{ width: size * 0.28, height: size * 0.28, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Simple bar chart for earnings (M6). */
export function BarChart({ data, highlightLast = true }: { data: { label: string; amount: number }[]; highlightLast?: boolean }) {
  const c = useColors();
  const max = Math.max(1, ...data.map((d) => d.amount));
  return (
    <View style={styles.chart} accessibilityLabel={`Earnings chart: ${data.map((d) => `${d.label} ${formatUGX(d.amount)}`).join(', ')}`}>
      {data.map((d, i) => {
        const h = Math.max(4, (d.amount / max) * 120);
        const hl = highlightLast && i === data.length - 1;
        return (
          <View key={`${d.label}-${i}`} style={styles.barCol}>
            <Text variant="caption" style={{ fontSize: 10 }}>
              {d.amount ? compactUGX(d.amount) : ''}
            </Text>
            <View style={{ height: h, width: '70%', borderRadius: 6, backgroundColor: hl ? c.primary : c.info, opacity: d.amount ? 1 : 0.25 }} />
            <Text variant="caption" style={{ fontFamily: hl ? Font.bold : Font.medium }}>
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function FinishLock({ openTasks, openQuotes }: { openTasks: number; openQuotes: number }) {
  const c = useColors();
  if (!openTasks && !openQuotes) return null;
  return (
    <Row gap={6}>
      <Lock size={14} color={c.textMuted} />
      <Text variant="caption">
        {[openTasks && `${openTasks} task${openTasks > 1 ? 's' : ''} open`, openQuotes && `${openQuotes} quote${openQuotes > 1 ? 's' : ''} awaiting owner`]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  timeline: { flexDirection: 'row' },
  stage: { flex: 1, alignItems: 'center', gap: 6 },
  stageLine: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  line: { flex: 1, height: 3 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56, gap: Space.sm },
  checkMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm, minHeight: 48 },
  checkbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  camBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quoteImg: { width: 60, height: 60, borderRadius: 12 },
  stat: { flex: 1, borderRadius: Radius.card, padding: Space.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 170, gap: 4 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
