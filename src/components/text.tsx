import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { Font, useColors } from '@/theme';

// The app's Text component: every piece of text uses it so fonts, sizes and colours stay consistent.

/** Text styles, from large headings down to small captions and labels. */
type Variant ='display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'money';
/** Which palette colour the text uses. */
type ToneKey ='text' | 'textMuted' | 'textSubtle' | 'primary' | 'danger' | 'success' | 'info' | 'onHeader' | 'onPrimary' | 'warning';

const variants: Record<Variant, TextStyle> = {
  display: { fontFamily: Font.heading, fontSize: 32, lineHeight: 38 },
  title: { fontFamily: Font.heading, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: Font.heading, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: Font.body, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: Font.semibold, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: Font.body, fontSize: 12, lineHeight: 16 },
  // 11 uppercase labels, 0.08 em
  label: { fontFamily: Font.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.9, textTransform: 'uppercase' },
  money: { fontFamily: Font.heading, fontSize: 28, lineHeight: 34 },
};

/** Props: any React Native Text prop, plus a style variant, a colour tone and centring. */
export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: ToneKey;
  center?: boolean;
}

/**
 * Themed text. Captions and labels default to the muted colour. System font scaling is capped at 1.3×
 * so large accessibility sizes don't break layouts.
 */
export function Text({ variant = 'body', tone, center, style, ...rest }: AppTextProps) {
  const c = useColors();
  const defaultTone: ToneKey = variant === 'caption' || variant === 'label' ? 'textMuted' : 'text';
  return (
    <RNText
      maxFontSizeMultiplier={1.3}
      style={[variants[variant], { color: c[tone ?? defaultTone] }, center && { textAlign: 'center' }, style]}
      {...rest}
    />
  );
}
