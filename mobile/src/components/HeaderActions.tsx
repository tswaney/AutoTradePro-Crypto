// mobile/src/components/HeaderActions.tsx
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  onNewBot?: () => void;
  onRefresh?: () => void;
  onSignOut?: () => void;
};

export default function HeaderActions({ onNewBot, onRefresh, onSignOut }: Props) {
  return (
    <View style={styles.headerRow}>
      {onNewBot && (
        <TouchableOpacity onPress={onNewBot}>
          <Text style={styles.headerLink}>New Bot</Text>
        </TouchableOpacity>
      )}
      {onRefresh && (
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.headerLink}>Refresh</Text>
        </TouchableOpacity>
      )}
      {onSignOut && (
        <TouchableOpacity onPress={onSignOut}>
          <Text style={styles.headerLink}>Sign out</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  headerLink: { color: '#7AA5FF', fontWeight: '600' },
});
