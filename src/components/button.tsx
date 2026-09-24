import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Font, Radius, Space, Touch, useColors } from '@/theme';

import { Text } from './text';

type Kind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'info' | 'onDark';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  kind?: Kind;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  size?: 'lg' | 'md' | 'sm';
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function haptic(kind: 'success' | 'warning' | 'light' = 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon: Icon,
  loading,
  disabled,
  size = 'lg',
  haptic: withHaptic,
  style,
  accessibilityHint,
}: ButtonProps) {
  const c = useColors();
  const palette: Record<Kind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    secondary: { bg: c.surfaceAlt, fg: c.text },
    danger: { bg: c.danger, fg: '#fff' },
    success: { bg: c.success, fg: '#fff' },
    info: { bg: c.info, fg: '#fff' },
    ghost: { bg: 'transparent', fg: c.text },
    outline: { bg: 'transparent', fg: c.text, border: c.border },
    onDark: { bg: 'rgba(255,255,255,0.12)', fg: '#ffffff' },
  };
  const p = palette[kind];
  const height = size === 'lg' ? Touch.primary : size === 'md' ? Touch.min : 40;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={() => {
        if (withHaptic) haptic('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          backgroundColor: p.bg,
          borderColor: p.border ?? 'transparent',
          borderWidth: p.border ? 1.5 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          paddingHorizontal: size === 'sm' ? Space.md : Space.lg,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={size === 'sm' ? 16 : 20} color={p.fg} strokeWidth={2.25} /> : null}
          <Text
            style={{ color: p.fg, fontFamily: Font.bold, fontSize: size === 'sm' ? 14 : 16 }}
            numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  color,
  background,
  size = Touch.min,
  badge,
}: {
  icon: LucideIcon;
  onPress?: () => void;
  label: string;
  color?: string;
  background?: string;
  size?: number;
  badge?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.icon,
        { width: size, height: size, backgroundColor: background ?? 'transparent', opacity: pressed ? 0.7 : 1 },
      ]}>
      <Icon size={22} color={color ?? c.text} strokeWidth={2} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: c.danger }]}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  icon: { borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: Font.bold, lineHeight: 12 },
});
