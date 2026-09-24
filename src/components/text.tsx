import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { Font, useColors } from '@/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'money';
type ToneKey = 'text' | 'textMuted' | 'textSubtle' | 'primary' | 'danger' | 'success' | 'info' | 'onHeader' | 'onPrimary' | 'warning';

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

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: ToneKey;
  center?: boolean;
}

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
