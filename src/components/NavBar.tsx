import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Clapperboard, Film, Heart, Home, Library, Search, Tv } from 'lucide-react-native';
import { useStreamHub } from '../state/useStreamHub';
import { useProfiles } from '../state/profiles';
import { Avatar } from './Avatar';
import { colors, fonts } from '../ui/theme';
import { useFocusRing } from '../ui/primitives';
import { Wordmark } from './Wordmark';
import { CastButton } from './CastControls';

export type Tab = 'home' | 'live' | 'movies' | 'shows' | 'mylist' | 'search';

const TABS: { id: Tab; label: string; Icon: typeof Home }[] = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'live', label: 'Live TV', Icon: Tv },
  { id: 'movies', label: 'Movies', Icon: Film },
  { id: 'shows', label: 'Shows', Icon: Clapperboard },
  { id: 'mylist', label: 'My List', Icon: Library },
  { id: 'search', label: 'Search', Icon: Search },
];

interface Props {
  tab: Tab;
  onTab(t: Tab): void;
  compact: boolean;
  gutter: number;
}

export function TopBar({ tab, onTab, compact, gutter }: Props) {
  return (
    <View style={[styles.top, { paddingHorizontal: gutter }]}>
      <Wordmark size={compact ? 18 : 20} />
      {!compact && (
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <TopTab key={t.id} label={t.label} Icon={t.Icon} active={tab === t.id} onPress={() => onTab(t.id)} />
          ))}
        </View>
      )}
      <View style={{ flex: 1 }} />
      <CastButton compact={compact} />
      <ProfileChip />
    </View>
  );
}

function TopTab({ label, Icon, active, onPress }: { label: string; Icon: typeof Home; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} accessibilityRole="tab" accessibilityLabel={`${label} tab`} accessibilityState={{ selected: active }} style={[styles.tab, (active || f.on) && styles.tabOn, f.on && styles.tabFocus]}>
      <Icon size={16} color={active ? colors.text : colors.textDim} strokeWidth={2.2} />
      <Text style={[styles.tabText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function ProfileChip() {
  const profile = useStreamHub((s) => s.profile);
  const signOut = useStreamHub((s) => s.signOut);
  const p = useProfiles((s) => s.profiles).find((x) => x.id === profile);
  const f = useFocusRing();
  if (!p) return null;
  return (
    <Pressable onPress={signOut} {...f.handlers} style={[styles.chip, f.on && styles.tabFocus]} accessibilityLabel="Switch profile">
      <Avatar profile={p} size={30} />
      <Text style={styles.chipText}>{p.name}</Text>
    </Pressable>
  );
}

export function BottomTabs({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  return (
    <View style={styles.bottom}>
      {TABS.map(({ id, label, Icon }) => {
        const on = tab === id;
        return (
          <Pressable key={id} onPress={() => onTab(id)} style={styles.btab} accessibilityRole="tab" accessibilityLabel={`${label} tab`} accessibilityState={{ selected: on }}>
            <Icon size={21} color={on ? colors.gold : colors.textFaint} strokeWidth={on ? 2.4 : 2} />
            <Text style={[styles.btabText, on && { color: colors.text }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 28, paddingTop: 20, paddingBottom: 12 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 38,
    borderRadius: 999, borderWidth: 1.5, borderColor: 'transparent',
  },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.08)' },
  tabFocus: { borderColor: colors.focus },
  tabText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 14 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4, paddingRight: 14, height: 38,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: 'transparent',
  },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: fonts.displayHeavy, fontSize: 14 },
  chipText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  bottom: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: 'rgba(8,9,13,0.97)',
    paddingBottom: 18, paddingTop: 8,
  },
  btab: { flex: 1, alignItems: 'center', gap: 4 },
  btabText: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 10.5 },
});
