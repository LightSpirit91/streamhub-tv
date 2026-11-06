/** Marquee design tokens. Dark cinema, lit by the content. */
export const colors = {
  bg: '#07070A',
  bgRaised: '#101016',
  card: '#14141C',
  cardHi: '#1C1C27',
  line: 'rgba(255,255,255,0.08)',
  text: '#F2F2F5',
  textDim: '#9A9AA6',
  textFaint: '#5E5E6A',
  gold: '#F5C451',
  live: '#FF3B3B',
  ok: '#22E07A',
  overlay: 'rgba(7,7,10,0.72)',
};

export const radius = { sm: 6, md: 10, lg: 16 };

export function flag(country?: string): string {
  if (!country || country === 'INT') return '🌐';
  const cc = country === 'UK' ? 'GB' : country;
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function qualityLabel(height: number): string | null {
  if (height >= 2160) return '4K';
  if (height >= 1080) return 'FHD';
  if (height >= 720) return 'HD';
  return null;
}
