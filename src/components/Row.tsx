import { memo, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, fonts, type } from '../ui/theme';

interface Props<T> {
  title: string;
  subtitle?: string;
  accent?: string;
  data: T[];
  keyOf(item: T): string;
  render(item: T, index: number): ReactElement;
  gutter: number;
  onSeeAll?(): void;
}

function RowBase<T>({ title, subtitle, accent, data, keyOf, render, gutter, onSeeAll }: Props<T>) {
  if (!data.length) return null;
  return (
    <View style={styles.row}>
      <View style={[styles.head, { paddingHorizontal: gutter }]}>
        {accent ? <View style={[styles.bar, { backgroundColor: accent }]} /> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        <View style={{ flex: 1 }} />
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} style={styles.all} accessibilityRole="button">
            <Text style={styles.allText}>See all</Text>
            <ChevronRight size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        horizontal
        data={data}
        keyExtractor={keyOf}
        renderItem={({ item, index }) => render(item, index)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: 12 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </View>
  );
}

export const Row = memo(RowBase) as typeof RowBase;

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { width: 3, height: 18, borderRadius: 2 },
  title: { ...type.h2, color: colors.text },
  sub: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 13 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 6 },
  allText: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13 },
});
