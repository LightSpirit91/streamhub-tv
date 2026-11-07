import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { cueAt, parseSubtitles, SUB_LANGS, type Cue, type SubChoice, type SubFile, type SubLang, type StreamTrack } from '../core/subtitles';
import { useFocusRing } from '../ui/primitives';
import { colors, fonts } from '../ui/theme';

const cache = new Map<string, Promise<Cue[]>>();

/** Downloads and reads a subtitle file (cached for the session). */
export function useSubtitleFile(url?: string): Cue[] | undefined {
  const [cues, setCues] = useState<Cue[] | undefined>(undefined);
  useEffect(() => {
    setCues(undefined);
    if (!url) return;
    let alive = true;
    if (!cache.has(url)) {
      const p = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then(parseSubtitles);
      p.catch(() => cache.delete(url));
      cache.set(url, p);
    }
    cache.get(url)!.then((c) => alive && setCues(c)).catch(() => alive && setCues([]));
    return () => {
      alive = false;
    };
  }, [url]);
  return cues;
}

/** Subtitle line drawn over the video (for subtitle files; stream captions are drawn by the player). */
export function SubtitleOverlay({ cues, time, rtl, raised, narrow }: { cues?: Cue[]; time: number; rtl?: boolean; raised?: boolean; narrow?: boolean }) {
  const cue = cues ? cueAt(cues, time) : undefined;
  if (!cue) return null;
  return (
    <View pointerEvents="none" style={[styles.subWrap, { bottom: raised ? (narrow ? 210 : 150) : 48 }]}>
      <Text style={[styles.subText, narrow && { fontSize: 18, lineHeight: 25 }, rtl && { writingDirection: 'rtl' }]}>{cue.text}</Text>
    </View>
  );
}

export interface SubOption {
  code: SubLang;
  track?: StreamTrack;
  file?: SubFile;
}

/** Where each of the four languages is available for what's playing. */
export function subOptions(tracks: StreamTrack[], files?: SubFile[]): SubOption[] {
  return SUB_LANGS.map((l) => ({ code: l.code, track: tracks.find((t) => t.lang === l.code), file: files?.find((f) => f.lang === l.code) }));
}

/** Subtitles menu in the player: Off, English, Español, Русский, עברית. */
export function SubtitleMenu({ choice, options, onPick, narrow }: { choice: SubChoice; options: SubOption[]; onPick(c: SubChoice): void; narrow?: boolean }) {
  const any = options.some((o) => o.track || o.file);
  return (
    <View style={[styles.menu, narrow && styles.menuNarrow]}>
      <Text style={styles.menuHead}>Subtitles</Text>
      <MenuItem label="Off" active={choice === 'off'} onPress={() => onPick('off')} />
      {SUB_LANGS.map((l) => {
        const o = options.find((x) => x.code === l.code)!;
        const where = o.track ? 'In the broadcast' : o.file ? 'Subtitle file' : 'Not available for this title';
        return <MenuItem key={l.code} label={l.native === l.label ? l.label : `${l.label} · ${l.native}`} note={where} dim={!o.track && !o.file} active={choice === l.code} onPress={() => onPick(l.code)} />;
      })}
      <Text style={styles.menuFoot}>
        {any ? 'Your choice is remembered and turns on wherever that language exists.' : 'No subtitles came with this title. Your choice is remembered for the next one.'}
      </Text>
    </View>
  );
}

function MenuItem({ label, note, active, dim, onPress }: { label: string; note?: string; active: boolean; dim?: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} accessibilityRole="button" accessibilityLabel={`Subtitles ${label}`} style={[styles.item, f.on && styles.itemOn]}>
      <View style={{ width: 20 }}>{active ? <Check size={18} color={colors.gold} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemLabel, dim && { color: colors.textDim }]}>{label}</Text>
        {note ? <Text style={[styles.itemNote, !dim && { color: colors.ok }]}>{note}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subWrap: { position: 'absolute', left: '8%', right: '8%', alignItems: 'center' },
  subText: {
    color: '#FFFFFF', fontFamily: fonts.bodySemi, fontSize: 24, lineHeight: 32, textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, overflow: 'hidden',
    textShadowColor: '#000', textShadowRadius: 3,
  },
  menu: {
    position: 'absolute', top: 96, right: 24, width: 320, padding: 14, borderRadius: 16, gap: 2,
    backgroundColor: 'rgba(28,23,25,0.96)', borderWidth: 1, borderColor: colors.lineHi,
  },
  menuNarrow: { top: 72, left: 16, right: 16, width: undefined },
  menuHead: { color: colors.text, fontFamily: fonts.display, fontSize: 18, marginBottom: 6, marginLeft: 6 },
  menuFoot: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, marginTop: 8, marginHorizontal: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  itemOn: { borderColor: colors.focus, backgroundColor: 'rgba(255,255,255,0.06)' },
  itemLabel: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 15 },
  itemNote: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 12, marginTop: 1 },
});
