// mobile/App.tsx
import React, { useCallback, useEffect, useState } from "react";
import { StatusBar, View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from "react-native";
import { NavigationContainer, useFocusEffect } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackScreenProps } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";

import HeaderActions from "./src/components/HeaderActions";
import SignInScreen from "./src/screens/SignInScreen";
import BotDetailScreen from "./src/screens/BotDetailScreen";
import NewBotScreen from "./src/screens/NewBotScreen";
import NewBotConfigScreen from "./src/screens/NewBotConfigScreen";
import { apiLogout } from "./api";

const API_BASE =
  (process as any)?.env?.EXPO_PUBLIC_API_BASE ||
  (global as any)?.EXPO_PUBLIC_API_BASE ||
  "http://localhost:4000";

const SIGNED_KEY = "autotradepro_signed_in";

type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  BotDetail: { id: string };
  NewBot: undefined;
  NewBotConfig: { draft?: any; strategy?: { id: string; name: string; version?: string } };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// -------------------- Home (Bot list) --------------------
type HomeProps = NativeStackScreenProps<RootStackParamList, "Home">;
function HomeScreen({ navigation }: HomeProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bots, setBots] = useState<Array<{ id: string; name?: string; status: string }>>([]);

  const fetchBots = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/bots`);
      const json = await res.json();
      setBots(Array.isArray(json) ? json : []);
    } catch {
      // swallow
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchBots(); }, [fetchBots]);

  // Re-fetch whenever we return to Home (e.g., after creating a bot)
  useFocusEffect(React.useCallback(() => {
    fetchBots();
    return () => {};
  }, [fetchBots]));

  useEffect(() => {
    navigation.setOptions({
      title: "Bots",
      headerRight: () => (
        <HeaderActions
          onNewBot={() => navigation.navigate("NewBot")}
          onRefresh={fetchBots}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
          }}
        />
      ),
    });
  }, [navigation, fetchBots]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B1117", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: "#97A3B6", marginTop: 10 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: "#0B1117" }}
      contentContainerStyle={{ padding: 16 }}
      data={bots}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchBots} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate("BotDetail", { id: item.id })} style={styles.botRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.botName}>{item.name || item.id}</Text>
            <Text style={styles.botSub}>{item.status}</Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      )}
      ListEmptyComponent={<Text style={{ color: "#97A3B6" }}>No bots yet.</Text>}
    />
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#0B1117" },
          headerTintColor: "#E6EDF3",
          headerTitleStyle: { color: "#E6EDF3" },
          contentStyle: { backgroundColor: "#0B1117" },
        }}
      >
        <Stack.Screen
          name="SignIn"
          options={{ headerShown: false, contentStyle: { backgroundColor: "#0B1117" } }}
          children={({ navigation }) => (
            <SignInScreen
              onSubmit={async () => {
                await SecureStore.setItemAsync(SIGNED_KEY, "1");
                navigation.reset({ index: 0, routes: [{ name: "Home" }] });
              }}
            />
          )}
        />

        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Bots" }} />
        <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: "Bot" }} />
        <Stack.Screen
          name="NewBot"
          component={NewBotScreen}
          options={{ title: "New Bot", contentStyle: { backgroundColor: "#0B1117" } }}
        />
        <Stack.Screen
          name="NewBotConfig"
          component={NewBotConfigScreen}
          options={{ title: "Configure Bot", contentStyle: { backgroundColor: "#0B1117" } }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  botRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#283142",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#0E131A",
  },
  botName: { color: "#E6EDF3", fontWeight: "600" },
  botSub: { color: "#97A3B6", marginTop: 2, fontSize: 12 },
  chev: { color: "#97A3B6", fontSize: 24, marginLeft: 8 },
});
