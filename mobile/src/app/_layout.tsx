import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { SessionProvider, useSession } from "@/lib/session";
import { handleResponse, openOnWeb, registerForPush, setupCategories } from "@/lib/notifications";
import { useTheme } from "@/lib/theme";

// Ask for Face ID again after the app has been in the background this long.
const RELOCK_MS = 3 * 60 * 1000;

export default function RootLayout() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const t = useTheme();
  const { ready, pairing } = useSession();
  const segments = useSegments();
  const [locked, setLocked] = useState(true);
  const backgroundedAt = useRef<number | null>(null);

  // Face ID on launch and when coming back after a while
  const unlock = async () => {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return setLocked(false);
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Jarvis" });
    if (r.success) setLocked(false);
  };

  useEffect(() => {
    void unlock();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") backgroundedAt.current = Date.now();
      if (s === "active" && backgroundedAt.current && Date.now() - backgroundedAt.current > RELOCK_MS) {
        setLocked(true);
        void unlock();
      }
      if (s === "active") backgroundedAt.current = null;
    });
    return () => sub.remove();
  }, []);

  // Not paired yet: go to the pairing screen
  useEffect(() => {
    if (!ready) return;
    const onPair = segments[0] === "pair";
    if (!pairing && !onPair) router.replace("/pair");
  }, [ready, pairing, segments]);

  // Notifications: buttons, taps and the push token
  useEffect(() => {
    void setupCategories();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      void handleResponse(r, (url) => void openOnWeb(url));
    });
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) {
        void handleResponse(r, (url) => void openOnWeb(url));
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (pairing) registerForPush().catch((e) => console.warn("push registration failed", e));
  }, [pairing]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Jarvis", headerLargeTitle: true }} />
        <Stack.Screen name="talk" options={{ title: "", presentation: "fullScreenModal", headerShown: false }} />
        <Stack.Screen name="chat" options={{ title: "Chat" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="pair" options={{ title: "Pair Jarvis", headerBackVisible: false }} />
      </Stack>
      {/* Voice mode stays usable when opened by Siri: the phone itself was
          unlocked to get here, and talking should not wait for a glance. */}
      {locked && ready && segments[0] !== "talk" && (
        <View style={[StyleSheet.absoluteFill, styles.lock, { backgroundColor: t.bg }]}>
          <Text style={[styles.lockTitle, { color: t.text }]}>Jarvis is locked</Text>
          <Pressable onPress={unlock} style={[styles.lockBtn, { backgroundColor: t.navy }]}>
            <Text style={{ color: t.bg, fontWeight: "600" }}>Unlock with Face ID</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { alignItems: "center", justifyContent: "center", gap: 20 },
  lockTitle: { fontSize: 22, fontWeight: "600" },
  lockBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
});
