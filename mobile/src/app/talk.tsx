import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VoiceSession, type Phase } from "@/lib/voice";
import { getPref, setPref } from "@/lib/storage";
import { useTheme } from "@/lib/theme";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Paused",
  standby: 'Say "Hey Jarvis"',
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

// Voice mode. Opened by the Talk button, Siri ("Talk to Jarvis"), the Action
// Button or jarvisapp://talk. ?ask=... starts with a question already asked;
// ?wake=1 starts in desk mode.
export default function TalkScreen() {
  useKeepAwake();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ask?: string; wake?: string }>();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [desk, setDesk] = useState(params.wake === "1");
  const level = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  const session = useMemo(
    () =>
      new VoiceSession(recorder, {
        onPhase: (p) => {
          setPhase(p);
          if (p === "listening" || p === "standby") setStatus("");
        },
        onLevel: (v) => Animated.timing(level, { toValue: v, duration: 90, useNativeDriver: true }).start(),
        onHeard: (x) => {
          setHeard(x);
          setReply("");
          setError("");
        },
        onReply: setReply,
        onStatus: setStatus,
        onError: setError,
      }),
    [recorder, level],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await getPref("voice");
      if (v) session.setVoice(v);
      const savedDesk = params.wake === "1" || (await getPref("deskMode")) === "1";
      if (cancelled) return;
      setDesk(savedDesk);
      await session.start({ wake: savedDesk, firstMessage: params.ask });
    })();
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
    return () => {
      cancelled = true;
      void session.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function toggleDesk(v: boolean) {
    setDesk(v);
    await setPref("deskMode", v ? "1" : "0");
    await session.stop();
    await session.start({ wake: v });
  }

  const scale = Animated.add(
    Animated.multiply(breathe, 0.04),
    Animated.add(1, Animated.multiply(level, phase === "standby" ? 0.15 : 0.45)),
  );
  const color = phase === "speaking" ? t.accent : phase === "thinking" ? t.warn : t.navy;

  return (
    <View style={[s.wrap, { backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={s.top}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch value={desk} onValueChange={toggleDesk} />
          <Text style={{ color: t.muted }}>Desk mode</Text>
        </View>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12}>
          <Text style={{ color: t.accent, fontSize: 17, fontWeight: "600" }}>Done</Text>
        </Pressable>
      </View>

      <Pressable
        style={s.orbWrap}
        onPress={() => {
          // Tap while Jarvis talks to interrupt; tap when paused to restart
          if (phase === "speaking") session.stopSpeaking();
          else if (phase === "idle") void session.start({ wake: desk });
        }}
      >
        <Animated.View style={[s.orb, { backgroundColor: color, opacity: phase === "idle" ? 0.35 : 0.95, transform: [{ scale }] }]} />
        <Text style={[s.phase, { color: t.text }]}>{status || PHASE_LABEL[phase]}</Text>
        {desk && phase === "standby" && <Text style={{ color: t.muted, marginTop: 6 }}>Keeps listening with the screen off</Text>}
      </Pressable>

      <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
        {heard ? <Text style={[s.heard, { color: t.muted }]}>“{heard}”</Text> : null}
        {reply ? <Text style={[s.reply, { color: t.text }]}>{reply}</Text> : null}
        {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20 },
  orbWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  orb: { width: 180, height: 180, borderRadius: 90 },
  phase: { marginTop: 36, fontSize: 20, fontWeight: "600" },
  heard: { fontSize: 16, fontStyle: "italic" },
  reply: { fontSize: 18, lineHeight: 26 },
});
