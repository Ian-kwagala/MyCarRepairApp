// Blueprint §12 — design system for mobile ("Grease-Proof UI").
// Colours, spacing, corner radii, touch-target sizes and font names shared by every screen.

/** Raw brand colours; screens should use the semantic Palette below instead. */
export const Brand = {
  navy: '#0f172a',
  blue: '#1E40AF',
  orange: '#F97316',
  red: '#EF4444',
  green: '#16a34a',
  canvas: '#f1f5f9',
} as const;

/**
 * Semantic colours for light and dark mode. Each "xSoft" is a tinted background for badges and banners,
 * and each "onX" is the text colour that reads well on top of X.
 */
export const Palette = {
  light: {
    background: Brand.canvas,
    surface: '#ffffff',
    surfaceAlt: '#e2e8f0',
    header: Brand.navy,
    onHeader: '#ffffff',
    text: '#0f172a',
    textMuted: '#475569',
    textSubtle: '#94a3b8',
    border: '#cbd5e1',
    primary: Brand.orange,
    onPrimary: '#ffffff',
    primarySoft: '#ffedd5',
    onPrimarySoft: '#c2410c',
    info: Brand.blue,
    infoSoft: '#dbeafe',
    danger: Brand.red,
    dangerSoft: '#fee2e2',
    success: Brand.green,
    successSoft: '#dcfce7',
    warning: '#d97706',
    warningSoft: '#fef3c7',
    overlay: 'rgba(15,23,42,0.55)',
  },
  dark: {
    background: '#020617',
    surface: Brand.navy,
    surfaceAlt: '#1e293b',
    header: '#020617',
    onHeader: '#ffffff',
    text: '#f8fafc',
    textMuted: '#cbd5e1',
    textSubtle: '#64748b',
    border: '#334155',
    primary: Brand.orange,
    onPrimary: '#ffffff',
    primarySoft: '#431407',
    onPrimarySoft: '#fdba74',
    info: '#60a5fa',
    infoSoft: '#1e3a8a',
    danger: Brand.red,
    dangerSoft: '#450a0a',
    success: '#22c55e',
    successSoft: '#052e16',
    warning: '#f59e0b',
    warningSoft: '#451a03',
    overlay: 'rgba(0,0,0,0.65)',
  },
} as const;

/** Shape of a palette (same keys for light and dark). */
export type Colors = { [K in keyof typeof Palette.light]: string };

/** Spacing scale in points, for margins, padding and gaps. */
export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Corner radii; `pill` fully rounds the ends. */
export const Radius = { card: 16, button: 14, sheet: 24, pill: 999 } as const;
/** Minimum touch-target heights, sized for gloved or greasy fingers. */
export const Touch = { min: 48, primary: 56 } as const;

/** Font family names loaded in the root layout (Inter for body text, Space Grotesk for headings). */
export const Font = {
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heading: 'SpaceGrotesk_700Bold',
  headingMedium: 'SpaceGrotesk_500Medium',
} as const;
