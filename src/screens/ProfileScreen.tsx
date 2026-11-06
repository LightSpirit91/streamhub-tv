import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { useStreamHub } from '../state/useStreamHub';
import { AVATAR_ICONS, AVATAR_PALETTES, MAX_PROFILES, useProfiles, type AvatarIcon, type Profile } from '../state/profiles';
import { Avatar, AvatarIconView } from '../components/Avatar';
import { Wordmark } from '../components/Wordmark';
import { Button, useFocusRing } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';

export function ProfileScreen() {
  const select = useStreamHub((s) => s.selectProfile);
  const profiles = useProfiles((s) => s.profiles);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const { width } = useWindowDimensions();
  const size = width < 600 ? 104 : 140;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['rgba(244,184,96,0.16)', 'rgba(242,140,106,0.06)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.8 }} />
      <ScrollView contentContainerStyle={styles.center}>
        <Wordmark size={22} />
        <Text style={styles.title}>{manage ? 'Manage profiles' : "Who's watching?"}</Text>
        <View style={styles.row}>
          {profiles.map((p, i) => (
            <Tile
              key={p.id}
              label={p.name}
              size={size}
              preferredFocus={i === 0}
              onPress={() => (manage ? setEditing(p) : select(p.id))}
              badge={manage ? <Pencil size={18} color={colors.text} /> : null}
            >
              <Avatar profile={p} size={size} />
            </Tile>
          ))}
          {profiles.length < MAX_PROFILES ? (
            <Tile label="Add profile" size={size} onPress={() => setEditing('new')}>
              <View style={[styles.add, { width: size, height: size, borderRadius: size * 0.3 }]}>
                <Plus size={size * 0.34} color={colors.textDim} strokeWidth={1.6} />
              </View>
            </Tile>
          ) : null}
        </View>
        <Button
          variant="ghost"
          label={manage ? 'Done' : 'Manage profiles'}
          icon={manage ? <Check size={16} color={colors.textDim} /> : <Pencil size={16} color={colors.textDim} />}
          textStyle={{ color: colors.textDim }}
          onPress={() => setManage((m) => !m)}
          style={{ marginTop: 36 }}
        />
      </ScrollView>
      {editing ? <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function Tile({ children, label, size, onPress, preferredFocus, badge }: { children: React.ReactNode; label: string; size: number; onPress(): void; preferredFocus?: boolean; badge?: React.ReactNode }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} hasTVPreferredFocus={preferredFocus} style={styles.tile} accessibilityLabel={label}>
      <View style={[styles.ring, { borderRadius: size * 0.34 }, f.on && styles.ringOn]}>
        {children}
        {badge ? <View style={styles.badge}>{badge}</View> : null}
      </View>
      <Text style={[styles.name, f.on && { color: colors.text }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function ProfileEditor({ profile, onClose }: { profile: Profile | null; onClose(): void }) {
  const { add, update, remove, profiles } = useProfiles();
  const forget = useStreamHub((s) => s.forgetProfile);
  const [name, setName] = useState(profile?.name ?? '');
  const [icon, setIcon] = useState<AvatarIcon>(profile?.icon ?? 'star');
  const [palette, setPalette] = useState(profile?.palette ?? profiles.length % AVATAR_PALETTES.length);
  const save = () => {
    if (profile) update(profile.id, { name, icon, palette });
    else add({ name, icon, palette });
    onClose();
  };
  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close">
          <X size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.sheetTitle}>{profile ? 'Edit profile' : 'New profile'}</Text>
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Avatar profile={{ name: name || 'A', icon, palette }} size={96} />
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          maxLength={20}
          autoFocus={!profile}
        />
        <Text style={styles.label}>Icon</Text>
        <View style={styles.grid}>
          {AVATAR_ICONS.map((i) => (
            <Pressable key={i} onPress={() => setIcon(i)} style={[styles.iconPick, icon === i && styles.picked]} accessibilityLabel={i}>
              <AvatarIconView icon={i} size={22} color={icon === i ? colors.gold : colors.textDim} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Color</Text>
        <View style={styles.grid}>
          {AVATAR_PALETTES.map(([a, b], i) => (
            <Pressable key={a} onPress={() => setPalette(i)} accessibilityLabel={`Color ${i + 1}`} style={[styles.swatchWrap, palette === i && styles.picked]}>
              <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch} />
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          {profile && profiles.length > 1 ? (
            <Button
              variant="ghost"
              label="Delete"
              icon={<Trash2 size={16} color={colors.live} />}
              textStyle={{ color: colors.live }}
              onPress={() => {
                remove(profile.id);
                forget(profile.id);
                onClose();
              }}
            />
          ) : <View />}
          <Button variant="primary" label="Save" icon={<Check size={16} color="#17110A" />} onPress={save} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { ...type.h1, color: colors.text, fontSize: 36, marginTop: 36, marginBottom: 40 },
  row: { flexDirection: 'row', gap: 36, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 900 },
  tile: { alignItems: 'center', width: 150 },
  ring: { padding: 5, borderWidth: 3, borderColor: 'transparent' },
  ringOn: { borderColor: colors.focus, transform: [{ scale: 1.05 }] },
  badge: {
    position: 'absolute', right: 0, bottom: 0, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceHi,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineHi,
  },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.lineHi, backgroundColor: colors.bgRaised },
  name: { ...type.title, color: colors.textDim, fontSize: 17, marginTop: 14 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,18,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 460, backgroundColor: colors.bgRaised, borderRadius: 24, padding: 24, gap: 10, borderWidth: 1, borderColor: colors.lineHi },
  sheetTitle: { ...type.h2, color: colors.text, textAlign: 'center' },
  input: {
    height: 50, borderRadius: 14, paddingHorizontal: 16, color: colors.text, fontFamily: fonts.bodySemi, fontSize: 17,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineHi, textAlign: 'center',
  },
  label: { color: colors.textFaint, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent' },
  picked: { borderColor: colors.gold },
  swatchWrap: { padding: 3, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  swatch: { width: 38, height: 38, borderRadius: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  close: {
    position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 18, zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center',
  },
});
