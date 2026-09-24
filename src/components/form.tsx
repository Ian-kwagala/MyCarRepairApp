import { Image } from 'expo-image';
import { Camera, ImagePlus, Star, X, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';

import { errorMessage } from '@/api/errors';
import type { LocalPhoto } from '@/models';
import { PermissionDeniedError, pickPhotos, type PhotoSource } from '@/services/media';
import { openSettings } from '@/services/location';
import { toast } from '@/store/toast';
import { Font, Radius, Space, Touch, useColors } from '@/theme';
import { toISODate } from '@/utils/format';

import { haptic } from './button';
import { Text } from './text';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  right?: ReactNode;
}

export function TextField({ label, error, hint, right, style, ...rest }: FieldProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View
        style={[
          styles.input,
          { backgroundColor: c.surface, borderColor: error ? c.danger : focused ? c.primary : c.border },
        ]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.textSubtle}
          maxFontSizeMultiplier={1.3}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.inputText, { color: c.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as unknown as TextStyle), rest.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }, style]}
          {...rest}
        />
        {right}
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}

/** Two-to-four option toggle (role toggle, fuel, transmission, tabs). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  counts,
  dark,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  counts?: Partial<Record<T, number>>;
  dark?: boolean;
}) {
  const c = useColors();
  return (
    <View style={[styles.segment, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : c.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o === value;
        const count = counts?.[o];
        return (
          <Pressable
            key={o}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o)}
            style={[styles.segmentItem, active && { backgroundColor: dark ? c.primary : c.surface }]}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: active ? Font.bold : Font.medium,
                fontSize: 14,
                color: active ? (dark ? '#fff' : c.text) : dark ? '#cbd5e1' : c.textMuted,
              }}>
              {labels?.[o] ?? o}
              {count ? ` ${count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primarySoft : c.surface },
      ]}>
      <Text style={{ fontFamily: Font.semibold, fontSize: 14, color: selected ? c.onPrimarySoft : c.text }}>{label}</Text>
    </Pressable>
  );
}

/** Large-target tile used for SOS issues, services and symptoms. */
export function Tile({
  icon: Icon,
  label,
  sub,
  selected,
  onPress,
  tone = 'primary',
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
}) {
  const c = useColors();
  const accent = tone === 'danger' ? c.danger : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: selected ? (tone === 'danger' ? c.dangerSoft : c.primarySoft) : c.surface,
          borderColor: selected ? accent : c.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      <View style={[styles.tileIcon, { backgroundColor: selected ? accent : c.surfaceAlt }]}>
        <Icon size={26} color={selected ? '#fff' : accent} strokeWidth={2.25} />
      </View>
      <Text variant="bodyStrong" center numberOfLines={2}>
        {label}
      </Text>
      {sub ? (
        <Text variant="caption" center numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Grid({ children, columns = 2 }: { children: ReactNode[]; columns?: number }) {
  return (
    <View style={styles.grid}>
      {children.map((child, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, padding: Space.xs }}>
          {child}
        </View>
      ))}
    </View>
  );
}

export function Stars({ value, onChange, size = 36 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: Space.xs }} accessibilityRole={onChange ? 'adjustable' : 'text'} accessibilityLabel={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={!onChange}
          accessibilityRole="button"
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
          onPress={() => {
            haptic('light');
            onChange?.(n);
          }}
          hitSlop={4}>
          <Star size={size} color={n <= value ? '#f59e0b' : c.border} fill={n <= value ? '#f59e0b' : 'transparent'} />
        </Pressable>
      ))}
    </View>
  );
}

/** Next-14-days date strip (O7). Past dates are not offered. */
export function DateStrip({ value, onChange, days = 14 }: { value: string; onChange: (d: string) => void; days?: number }) {
  const c = useColors();
  const today = new Date();
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm }}>
      {dates.map((d) => {
        const iso = toISODate(d);
        const active = iso === value;
        return (
          <Pressable
            key={iso}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={d.toDateString()}
            onPress={() => onChange(iso)}
            style={[styles.date, { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border }]}>
            <Text style={{ fontFamily: Font.bold, fontSize: 11, color: active ? '#fff' : c.textMuted }}>
              {d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
            </Text>
            <Text style={{ fontFamily: Font.heading, fontSize: 22, color: active ? '#fff' : c.text }}>{d.getDate()}</Text>
            <Text style={{ fontSize: 11, color: active ? '#fff' : c.textMuted }}>
              {d.toLocaleDateString('en-GB', { month: 'short' })}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function PhotoStrip({ uris, onRemove, size = 88 }: { uris: string[]; onRemove?: (i: number) => void; size?: number }) {
  const c = useColors();
  if (!uris.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm }}>
      {uris.map((u, i) => (
        <View key={`${u}-${i}`}>
          <Image source={{ uri: u }} style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.surfaceAlt }} contentFit="cover" accessibilityLabel={`Photo ${i + 1}`} />
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              onPress={() => onRemove(i)}
              style={[styles.remove, { backgroundColor: c.header }]}
              hitSlop={8}>
              <X size={14} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/** Camera or library picker with compression; max photos enforced (≤ 5). */
export function PhotoPicker({
  photos,
  onChange,
  max,
  existing = [],
  onRemoveExisting,
  label = 'Photos',
}: {
  photos: LocalPhoto[];
  onChange: (p: LocalPhoto[]) => void;
  max: number;
  existing?: string[];
  onRemoveExisting?: (i: number) => void;
  label?: string;
}) {
  const c = useColors();
  const remaining = max - photos.length - existing.length;
  const pick = async (source: PhotoSource) => {
    try {
      const got = await pickPhotos(source, remaining);
      if (got.length) onChange([...photos, ...got].slice(0, max - existing.length));
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        toast({ title: 'Permission needed', body: `${e.message} Tap to open settings.`, tone: 'warning', onPress: openSettings });
      } else toast({ title: 'Could not add photo', body: errorMessage(e), tone: 'danger' });
    }
  };
  return (
    <View style={{ gap: Space.sm }}>
      <Text variant="label">
        {label} · {existing.length + photos.length}/{max}
      </Text>
      {existing.length ? <PhotoStrip uris={existing} onRemove={onRemoveExisting} /> : null}
      <PhotoStrip uris={photos.map((p) => p.uri)} onRemove={(i) => onChange(photos.filter((_, j) => j !== i))} />
      {remaining > 0 ? (
        <View style={{ flexDirection: 'row', gap: Space.sm }}>
          <Pressable accessibilityRole="button" onPress={() => pick('camera')} style={[styles.pick, { borderColor: c.border, backgroundColor: c.surface }]}>
            <Camera size={22} color={c.primary} />
            <Text variant="bodyStrong">Camera</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => pick('library')} style={[styles.pick, { borderColor: c.border, backgroundColor: c.surface }]}>
            <ImagePlus size={22} color={c.primary} />
            <Text variant="bodyStrong">Gallery</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: Touch.min + 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.md,
  },
  inputText: { flex: 1, fontFamily: Font.medium, fontSize: 16, paddingVertical: 10 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 14, gap: 4 },
  segmentItem: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 6 },
  chip: { borderWidth: 1.5, borderRadius: Radius.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  tile: { borderWidth: 1.5, borderRadius: Radius.card, padding: Space.md, alignItems: 'center', gap: Space.sm, minHeight: 124, justifyContent: 'center' },
  tileIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Space.xs },
  date: { width: 64, paddingVertical: Space.sm, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', gap: 2 },
  remove: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pick: { flex: 1, minHeight: Touch.min + 8, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', flexDirection: 'row', gap: Space.sm, alignItems: 'center', justifyContent: 'center' },
});
