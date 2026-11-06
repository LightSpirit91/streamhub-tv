import { Platform } from 'react-native';

/**
 * Marquee design tokens. Dark cinema, lit by the content.
 * Type: Outfit (display) + Manrope (interface). No emoji anywhere: icons are
 * lucide vectors, flags are real flag images.
 */
export const colors = {
  // Warm, cozy evening palette: espresso and plum instead of pure black.
  bg: '#1C1719',
  bgRaised: '#241E21',
  surface: '#2C2528',
  surfaceHi: '#372E32',
  line: 'rgba(255,240,228,0.08)',
  lineHi: 'rgba(255,240,228,0.17)',
  text: '#FBF5EF',
  textDim: '#CDBFB6',
  textFaint: '#968880',
  gold: '#F4B860',
  goldDeep: '#8A5A1C',
  coral: '#F28C6A',
  live: '#FF5B5B',
  ok: '#5BD69A',
  focus: '#FFFFFF',
  overlay: 'rgba(28,23,25,0.84)',
};

/** Background as RGB, for gradients that fade into the page. */
export const BG_RGB = '28,23,25';
export const bgA = (a: number) => `rgba(${BG_RGB},${a})`;

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
