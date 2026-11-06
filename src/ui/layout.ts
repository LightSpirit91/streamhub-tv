import { useWindowDimensions } from 'react-native';
import { formFactor, type FormFactor } from '../services/device';

export interface Layout {
  ff: FormFactor;
  width: number;
  height: number;
  gutter: number;
  cardWidth: number;
  posterWidth: number;
  compact: boolean;
}

/** One design, four densities: TV, desktop, tablet, phone. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const ff = formFactor(width);
  const gutter = ff === 'tv' ? Math.round(width * 0.05) : ff === 'phone' ? 16 : 40;
  const cardWidth = ff === 'tv' ? 260 : ff === 'desktop' ? 232 : ff === 'tablet' ? 196 : 156;
  const posterWidth = ff === 'tv' ? 180 : ff === 'desktop' ? 160 : ff === 'tablet' ? 140 : 112;
  return { ff, width, height, gutter, cardWidth, posterWidth, compact: ff === 'phone' };
}
