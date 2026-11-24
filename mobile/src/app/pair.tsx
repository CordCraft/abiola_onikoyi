import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useSession } from "@/lib/session";
import { DEFAULT_HOST } from "@/lib/storage";
import { getToday } from "@/lib/api";
import { useTheme } from "@/lib/theme";

// Pairing: Jarvis on the web (Settings, "iPhone app") mints a device token and
// opens jarvisapp://pair?token=...&host=..., which lands here. Pasting the
// copied code works too.
export default function PairScreen() {
  const t = useTheme();
  const { pair } = useSession();
  const params = useLocalSearchParams<{ token?: string; host?: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish(token: string, host: string) {
    setBusy(true);
    setError("");
    try {
      await pair({ token, host: host.replace(/\/+$/, "") });
      await getToday(); // proves the token works
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.token) void finish(params.token, params.host || DEFAULT_HOST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  function fromCode(raw: string) {
    const text = raw.trim();
    const m = /token=([^&\s]+)(?:&host=([^&\s]+))?/.exec(text);
    if (m) return finish(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : DEFAULT_HOST);
    if (text.split(".").length === 3) return finish(text, DEFAULT_HOST);
    setError("That does not look like a Jarvis pairing code.");
  }

  return (
    <View style={[s.wrap, { backgroundColor: t.bg }]}>
      <Text style={[s.h, { color: t.text }]}>Connect this iPhone to Jarvis</Text>
      <Text style={{ color: t.muted, fontSize: 16, lineHeight: 23 }}>
        Open Jarvis Settings on the web, tap “Pair this iPhone”, then “Open in the Jarvis app”. Or copy the pairing code and paste it below.
      </Text>
      <Pressable
        style={[s.btn, { backgroundColor: t.navy }]}
        onPress={() => WebBrowser.openBrowserAsync(`${DEFAULT_HOST}/jarvis/settings`)}
      >
        <Text style={{ color: t.bg, fontWeight: "600", fontSize: 16 }}>Open Jarvis Settings</Text>
      </Pressable>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Paste pairing code"
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable style={[s.btn, s.half, { borderColor: t.border, borderWidth: 1 }]} onPress={async () => fromCode(await Clipboard.getStringAsync())}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Paste and connect</Text>
        </Pressable>
        <Pressable style={[s.btn, s.half, { backgroundColor: t.accent }]} onPress={() => fromCode(code)}>
          <Text style={{ color: "#fff", fontWeight: "600" }}>Connect</Text>
        </Pressable>
      </View>
      {busy && <ActivityIndicator />}
      {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 18 },
  h: { fontSize: 24, fontWeight: "700" },
  btn: { alignItems: "center", paddingVertical: 14, borderRadius: 14 },
  half: { flex: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
