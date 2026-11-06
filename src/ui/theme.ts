import { Platform } from 'react-native';

/**
 * Marquee design tokens. Dark cinema, lit by the content.
 * Type: Outfit (display) + Manrope (interface). No emoji anywhere: icons are
 * lucide vectors, flags are real flag images.
 */
export const colors = {
  bg: '#06070B',
  bgRaised: '#0D0F15',
  surface: '#12141C',
  surfaceHi: '#1A1D27',
  line: 'rgba(255,255,255,0.07)',
  lineHi: 'rgba(255,255,255,0.16)',
  text: '#F4F5F7',
  textDim: '#A3A8B5',
  textFaint: '#666C7A',
  gold: '#F2C14E',
  goldDeep: '#7A5A12',
  live: '#FF4545',
  ok: '#2BD67B',
  focus: '#FFFFFF',
  overlay: 'rgba(6,7,11,0.78)',
};

export const radius = { sm: 6, md: 10, lg: 14, xl: 22, pill: 999 };

export const fonts = {
  display: 'Outfit_700Bold',
  displayHeavy: 'Outfit_800ExtraBold',
  displayMedium: 'Outfit_500Medium',
  body: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
  bodySemi: 'Manrope_600SemiBold',
};

export const type = {
  hero: { fontFamily: fonts.displayHeavy, fontSize: 48, letterSpacing: -1, lineHeight: 52 },
  h1: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.display, fontSize: 21, letterSpacing: -0.2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15 },
  body: { fontFamily: fonts.body, fontSize: 14 },
  small: { fontFamily: fonts.bodySemi, fontSize: 12 },
  overline: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.2 },
} as const;

/** Flag image (flagcdn.com, public CDN of flag PNGs). Undefined for international. */
export function flagUri(country?: string): string | undefined {
  if (!country || country === 'INT' || !/^[A-Z]{2}$/.test(country)) return undefined;
  const cc = country === 'UK' ? 'gb' : country.toLowerCase();
  return `https://flagcdn.com/w40/${cc}.png`;
}

export function qualityLabel(height: number): string | null {
  if (height >= 2160) return '4K';
  if (height >= 1080) return 'FHD';
  if (height >= 720) return 'HD';
  return null;
}

export const isWeb = Platform.OS === 'web';
export const isTV = Platform.isTV;
