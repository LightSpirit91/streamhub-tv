import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../ui/theme';

/** STREAMHUB wordmark: a gold play-notch mark plus tight display type. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <View style={[styles.mark, { width: size * 1.15, height: size * 1.15, borderRadius: size * 0.3 }]}>
        <View
          style={{
            width: 0, height: 0, marginLeft: size * 0.1,
            borderTopWidth: size * 0.28, borderBottomWidth: size * 0.28, borderLeftWidth: size * 0.44,
            borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: colors.bg,
          }}
        />
      </View>
      <Text style={[styles.text, { fontSize: size }]}>
        Stream<Text style={{ color: colors.gold }}>Hub</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.displayHeavy, color: colors.text, letterSpacing: -0.5 },
});
