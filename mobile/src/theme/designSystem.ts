// mobile/src/theme/designSystem.ts
export const colors = {
  background: '#0B0F14',
  surface: '#11161C',
  surfaceAlt: '#0E1319',
  primary: '#5B8CFF',
  primaryAlt: '#7AA5FF',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  text: '#E6EDF3',
  textMuted: '#97A3B6',
  border: 'rgba(255,255,255,0.08)',
  cardShadow: 'rgba(0,0,0,0.35)'
};
export const spacing = (n: number) => n * 8;
export const radii = { sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const typography = {
  fontRegular: 'System',
  fontMono: 'Menlo',
  h1: 28, h2: 22, h3: 18, body: 16, small: 13, tiny: 11,
};
export const cardStyle = {
  backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border,
  shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4,
} as const;