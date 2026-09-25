import type { LucideIcon } from 'lucide-react-native';
import { CircleAlert, WifiOff } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage, isNetworkError } from '@/api/errors';
import { useOnline } from '@/hooks/use-online';
import { useToast } from '@/store/toast';
import { Font, Radius, Space, useColors } from '@/theme';
import type { Tone } from '@/utils/jobs';

import { Button } from './button';
import { Text } from './text';

// Components that tell the user what's going on: status pills, empty/error/loading states, notices,
// the offline banner, toasts and progress bars.

/** Small rounded uppercase badge, e.g. a job status. */
export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useColors();
  // [background, text colour] for each tone.
  const map: Record<Tone, [string, string]> = {
    info: [c.infoSoft, c.info],
    warning: [c.warningSoft, c.warning],
    success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger],
    neutral: [c.surfaceAlt, c.textMuted],
    primary: [c.primarySoft, c.onPrimarySoft],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} accessibilityLabel={`Status: ${label}`}>
      <Text style={{ color: fg, fontFamily: Font.bold, fontSize: 11, letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** Placeholder for an empty list: icon, title, optional explanation and optional action button. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
        <Icon size={32} color={c.textMuted} />
      </View>
      <Text variant="heading" center>
        {title}
      </Text>
      {body ? (
        <Text tone="textMuted" center style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: Space.sm, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/** Red error box with a friendly message (a Wi-Fi icon for connection errors) and an optional Retry button. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.error, { backgroundColor: c.dangerSoft }]}>
      <View style={{ flexDirection: 'row', gap: Space.sm, alignItems: 'center' }}>
        {isNetworkError(error) ? <WifiOff size={18} color={c.danger} /> : <CircleAlert size={18} color={c.danger} />}
        <Text style={{ flex: 1 }} tone="danger">
          {errorMessage(error)}
        </Text>
      </View>
      {onRetry ? <Button title="Retry" kind="outline" size="sm" onPress={onRetry} /> : null}
    </View>
  );
}

/** Tinted one-line message box with an icon, for tips and warnings inside a screen. */
export function InlineNotice({ icon: Icon = CircleAlert, children, tone = 'info' }: { icon?: LucideIcon; children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const c = useColors();
  const bg = { info: c.infoSoft, warning: c.warningSoft, danger: c.dangerSoft, success: c.successSoft }[tone];
  const fg = { info: c.info, warning: c.warning, danger: c.danger, success: c.success }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Icon size={18} color={fg} />
      <Text style={{ flex: 1, color: fg }}>{children}</Text>
    </View>
  );
}

/** Skeleton cards — never blank screens while loading (§10.6). */
export function Skeleton({ height = 72, width = '100%', radius = Radius.card }: { height?: number; width?: DimensionValue; radius?: number }) {
  const c = useColors();
  const [opacity] = useState(() => new Animated.Value(0.5));
  // Gently pulse the placeholder's opacity until it unmounts.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ height, width, borderRadius: radius, backgroundColor: c.surfaceAlt, opacity }} />;
}

/** A stack of loading placeholders for a list. */
export function SkeletonList({ count = 3, height = 84 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: Space.md }} accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

/** Orange strip saying the device is offline and cached data is shown. Hidden while online. */
export function OfflineBanner() {
  const online = useOnline();
  const c = useColors();
  if (online) return null;
  return (
    <View style={[styles.offline, { backgroundColor: c.warning }]} accessibilityLiveRegion="polite">
      <WifiOff size={16} color="#fff" />
      <Text style={{ color: '#fff', fontFamily: Font.semibold, fontSize: 13 }}>You are offline · showing saved data</Text>
    </View>
  );
}

/**
 * Renders the toasts from the toast store at the top of the screen. Mounted once in the root layout.
 * Tapping a toast closes it and runs its action.
 */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const c = useColors();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { top: insets.top + Space.sm }]}>
      {toasts.map((t) => {
        const accent = { info: c.info, success: c.success, danger: c.danger, warning: c.warning }[t.tone];
        return (
          <Pressable
            key={t.id}
            accessibilityRole="alert"
            onPress={() => {
              dismiss(t.id);
              t.onPress?.();
            }}
            style={[styles.toast, { backgroundColor: c.header, borderLeftColor: accent }]}>
            <Text style={{ color: '#fff', fontFamily: Font.bold }}>{t.title}</Text>
            {t.body ? <Text style={{ color: '#cbd5e1', fontSize: 13 }}>{t.body}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal progress bar; `pct` is clamped to 0–100. */
export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const c = useColors();
  return (
    <View
      style={[styles.bar, { backgroundColor: c.surfaceAlt }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', backgroundColor: color ?? c.primary, borderRadius: 4 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  empty: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.xxl, paddingHorizontal: Space.lg },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: Space.sm },
  error: { borderRadius: Radius.card, padding: Space.lg, gap: Space.md },
  notice: { borderRadius: 12, padding: Space.md, flexDirection: 'row', gap: Space.sm, alignItems: 'center' },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: 6 },
  toastWrap: { position: 'absolute', left: Space.lg, right: Space.lg, gap: Space.sm, zIndex: 1000 },
  toast: {
    borderRadius: 14,
    padding: Space.md,
    borderLeftWidth: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
