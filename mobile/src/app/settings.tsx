import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useSession } from "@/lib/session";
import { getPref, setPref } from "@/lib/storage";
import { registerForPush, unregisterPush } from "@/lib/notifications";
import { useTheme } from "@/lib/theme";

const VOICES = [
  { id: "bm_george", label: "George (British)" },
  { id: "bm_lewis", label: "Lewis (British)" },
  { id: "am_michael", label: "Michael (American)" },
  { id: "bf_emma", label: "Emma (British)" },
];

const SIRI_PHRASES = [
  "Hey Siri, what's left in Jarvis",
  "Hey Siri, talk to Jarvis",
  "Hey Siri, add a task in Jarvis",
  "Hey Siri, mark a task done in Jarvis",
  "Hey Siri, start desk mode in Jarvis",
];

export default function SettingsScreen() {
  const t = useTheme();
  const { pairing, unpair } = useSession();
  const [voice, setVoice] = useState("bm_george");
  const [desk, setDesk] = useState(false);
  const [push, setPush] = useState<string | null>(null);

  useEffect(() => {
    void getPref("voice").then((v) => v && setVoice(v));
    void getPref("deskMode").then((v) => setDesk(v === "1"));
  }, []);

  const row = [s.row, { backgroundColor: t.card, borderColor: t.border }];
  const label = { color: t.text, fontSize: 16 };
  const sub = { color: t.muted, fontSize: 13, marginTop: 2 };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 22 }}>
      <View style={{ gap: 8 }}>
        <Text style={[s.h, { color: t.muted }]}>Voice</Text>
        {VOICES.map((v) => (
          <Pressable key={v.id} style={row} onPress={async () => { setVoice(v.id); await setPref("voice", v.id); }}>
            <Text style={label}>{v.label}</Text>
            {voice === v.id && <Text style={{ color: t.accent, fontWeight: "700" }}>✓</Text>}
          </Pressable>
        ))}
        <View style={row}>
          <View style={{ flex: 1 }}>
            <Text style={label}>Desk mode by default</Text>
            <Text style={sub}>Voice mode waits for “Hey Jarvis” and keeps listening with the screen off. Best on a charger.</Text>
          </View>
          <Switch value={desk} onValueChange={async (v) => { setDesk(v); await setPref("deskMode", v ? "1" : "0"); }} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[s.h, { color: t.muted }]}>Siri</Text>
        <View style={[row, { flexDirection: "column", alignItems: "flex-start", gap: 6 }]}>
          {SIRI_PHRASES.map((p) => (
            <Text key={p} style={label}>“{p}”</Text>
          ))}
          <Text style={sub}>
            To wake it with just “Hey Jarvis”: Settings, Accessibility, Vocal Shortcuts, Set Up, choose the Jarvis shortcut “Talk to Jarvis” and say “Hey Jarvis” three times.
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[s.h, { color: t.muted }]}>Notifications</Text>
        <Pressable
          style={row}
          onPress={async () => {
            try {
              setPush((await registerForPush()) ? "On" : "Not allowed. Turn on in iOS Settings, Jarvis, Notifications.");
            } catch (e) {
              setPush(String(e));
            }
          }}
        >
          <Text style={label}>Re-register this iPhone</Text>
          <Text style={sub}>{push ?? ""}</Text>
        </Pressable>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[s.h, { color: t.muted }]}>Connection</Text>
        <View style={row}>
          <View style={{ flex: 1 }}>
            <Text style={label}>{pairing?.host ?? "Not paired"}</Text>
            <Text style={sub}>
              App {Constants.expoConfig?.version} · update {Updates.updateId?.slice(0, 8) ?? "built in"}
            </Text>
          </View>
        </View>
        <Pressable
          style={row}
          onPress={() =>
            Alert.alert("Unpair this iPhone?", "Jarvis will forget this app until you pair it again.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Unpair",
                style: "destructive",
                onPress: async () => {
                  await unregisterPush();
                  await unpair();
                  router.replace("/pair");
                },
              },
            ])
          }
        >
          <Text style={{ color: t.danger, fontSize: 16 }}>Unpair</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
});
