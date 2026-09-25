import { router } from 'expo-router';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStatusBar } from '@/hooks/use-status-bar';
import { Radius, Space, useColors } from '@/theme';

import { IconButton } from './button';
import { OfflineBanner } from './feedback';
import { Text } from './text';

// Layout building blocks used by every screen: the screen frame with header, cards, sections, rows and
// dividers.

export interface HeaderProps {
  title?: string;
  /** Small uppercase line above the title (e.g. "Step 1 of 3"). */
  eyebrow?: string;
  /** Show a back button: true goes back (or home if there's no history), a function runs custom logic. */
  back?: boolean | (() => void);
  /** Content on the right side of the header, e.g. icon buttons. */
  right?: ReactNode;
  /** Navy header with white text. */
  dark?: boolean;
}

/** Top bar of a screen: optional back button, eyebrow + title, and right-hand actions. */
export function Header({ title, eyebrow, back, right, dark }: HeaderProps) {
  const c = useColors();
  const fg = dark ? c.onHeader : c.text;
  const onBack = typeof back === 'function' ? back : () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.header}>
      {back ? <IconButton icon={ChevronLeft} label="Back" onPress={onBack} color={fg} /> : null}
      <View style={{ flex: 1, paddingLeft: back ? 0 : Space.xs }}>
        {eyebrow ? (
          <Text variant="label" style={{ color: dark ? '#cbd5e1' : c.textMuted }}>
            {eyebrow}
          </Text>
        ) : null}
        {title ? (
          <Text variant="heading" style={{ color: fg }} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export interface ScreenProps extends HeaderProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Pull-to-refresh state and handler. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Actions pinned to the bottom of the screen. */
  footer?: ReactNode;
  /** Extra content drawn inside the header area, below the title. */
  headerContent?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  noHeader?: boolean;
  /** Bottom tab screens: tab bar handles the bottom inset. */
  inTabs?: boolean;
}

/** Standard screen: navy header option, 16 dp padding, offline banner, sticky footer action. */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  headerContent,
  contentStyle,
  noHeader,
  inTabs,
  ...header
}: ScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const headerBg = header.dark ? c.header : c.background;
  // Light status-bar text on the navy header; theme default otherwise.
  useStatusBar(header.dark ? 'light' : 'auto');
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, { paddingBottom: footer ? Space.lg : Space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined
      }>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );
  // The keyboard-avoiding wrapper keeps the footer button above the on-screen keyboard on iOS.
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ backgroundColor: headerBg, paddingTop: insets.top }}>
        {noHeader ? null : <Header {...header} />}
        {headerContent}
      </View>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? (
          <View
            style={[
              styles.footer,
              { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: (inTabs ? 0 : insets.bottom) + Space.md },
            ]}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Rounded content box. With `onPress` it becomes a button that dims and shrinks slightly when pressed. */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  tone,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'default' | 'dark' | 'danger' | 'primary';
}) {
  const c = useColors();
  const bg = tone === 'dark' ? c.header : tone === 'danger' ? c.danger : tone === 'primary' ? c.primary : c.surface;
  const inner = [styles.card, { backgroundColor: bg, borderColor: tone && tone !== 'default' ? 'transparent' : c.border }, style];
  if (!onPress) return <View style={inner}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [inner, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      {children}
    </Pressable>
  );
}

/** A titled group of content, with an optional action (like "See all") beside the title. */
export function Section({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: Space.sm, marginTop: Space.xl }, style]}>
      <View style={styles.sectionHead}>
        <Text variant="label">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Lays children out side by side, vertically centred, with a gap. */
export function Row({ children, gap = Space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

/** Menu-style row: icon, title, subtitle and right-hand content. Tappable when `onPress` is given; `danger` makes it red. */
export function ListRow({
  icon: Icon,
  title,
  subtitle,
  right,
  onPress,
  danger,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.listRow, { backgroundColor: pressed ? c.surfaceAlt : 'transparent' }]}>
      {Icon ? (
        <View style={[styles.listIcon, { backgroundColor: danger ? c.dangerSoft : c.surfaceAlt }]}>
          <Icon size={20} color={danger ? c.danger : c.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" tone={danger ? 'danger' : 'text'}>
          {title}
        </Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Thin horizontal separator line. */
export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: Space.xs }} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.sm, minHeight: 56, gap: Space.xs },
  content: { padding: Space.lg, gap: Space.md },
  footer: { paddingHorizontal: Space.lg, paddingTop: Space.md, borderTopWidth: StyleSheet.hairlineWidth, gap: Space.sm },
  card: { borderRadius: Radius.card, padding: Space.lg, borderWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, paddingHorizontal: Space.xs, minHeight: 56, borderRadius: 12 },
  listIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
