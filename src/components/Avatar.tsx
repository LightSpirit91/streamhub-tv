import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Cat, Coffee, Crown, Dog, Film, Flower2, Gamepad2, Heart, Leaf, Moon, Mountain, Music, Rocket, Sparkles, Star, Sun,
} from 'lucide-react-native';
import { AVATAR_PALETTES, type AvatarIcon, type Profile } from '../state/profiles';
import { fonts } from '../ui/theme';

const ICONS: Record<AvatarIcon, typeof Heart> = {
  heart: Heart, star: Star, sparkles: Sparkles, sun: Sun, moon: Moon, flower: Flower2, crown: Crown, leaf: Leaf,
  music: Music, coffee: Coffee, rocket: Rocket, cat: Cat, dog: Dog, gamepad: Gamepad2, film: Film, mountain: Mountain,
};

export function AvatarIconView({ icon, size, color = '#fff' }: { icon: AvatarIcon; size: number; color?: string }) {
  const I = ICONS[icon] ?? Star;
  return <I size={size} color={color} strokeWidth={1.8} />;
}

/** Rounded-square avatar: soft gradient, glossy highlight, line icon. */
export function Avatar({ profile, size }: { profile: Pick<Profile, 'name' | 'icon' | 'palette' | 'letter'>; size: number }) {
  const [a, b] = AVATAR_PALETTES[profile.palette % AVATAR_PALETTES.length];
  const r = Math.round(size * 0.3);
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: r, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <LinearGradient
        colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.6 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: size * 0.6 }}
      />
      {profile.letter ? (
        <Text style={{ color: '#fff', fontFamily: fonts.displayHeavy, fontSize: size * 0.44 }}>{profile.name.trim()[0]?.toUpperCase() ?? '?'}</Text>
      ) : (
        <AvatarIconView icon={profile.icon} size={Math.round(size * 0.44)} />
      )}
    </LinearGradient>
  );
}
