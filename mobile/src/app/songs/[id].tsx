import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { createAudioPlayer } from "expo-audio";
import { deleteSong, getSong, songAction, type Song } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

// One liked song: what it is, and your own version ready for Suno. Each part
// has its own Copy button; "Open Suno" switches to the Suno app, where you
// paste them into Custom mode (Lyrics, Style of Music, Title).
export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [song, setSong] = useState<Song | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [player] = useState(() => createAudioPlayer(null));
  const [playing, setPlaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSong(await getSong(id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load the song");
    }
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      player.remove();
    };
  }, [load, player]);

  const pending = song && (song.status === "writing" || song.generations.some((g) => g.status === "queued" || g.status === "running"));
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void load(), 4000);
    return () => clearTimeout(timer);
  }, [pending, song, load]);

  const act = async (body: Parameters<typeof songAction>[1]) => {
    setBusy(true);
    setMsg(null);
    try {
      setSong(await songAction(id, body));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not work");
    }
    setBusy(false);
  };

  const copy = async (label: string, text: string) => {
    await Clipboard.setStringAsync(text);
    void Haptics.selectionAsync();
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const play = (url: string) => {
    if (playing === url) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.replace({ uri: url });
    player.play();
    setPlaying(url);
  };

  if (!song) {
    return <View style={s.center}>{msg ? <Text style={s.muted}>{msg}</Text> : <ActivityIndicator />}</View>;
  }

  const a = song.analysis;
  const suno = song.suno;

  const Copy = ({ label, text }: { label: string; text: string }) => (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.label}>{label}</Text>
        <Pressable onPress={() => copy(label, text)} style={[s.chip, { backgroundColor: copied === label ? t.accent : t.navy }]}>
          <Text style={{ color: t.bg, fontWeight: "700" }}>{copied === label ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <Text selectable style={s.body}>{text}</Text>
    </View>
  );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {song.thumbnail && <Image source={{ uri: song.thumbnail }} style={s.art} />}
        <View style={{ flex: 1 }}>
          <Text style={s.muted}>You liked</Text>
          <Text style={s.h1}>{song.title}</Text>
          <Text style={s.muted}>{song.artist}</Text>
          {song.link && (
            <Text style={[s.muted, { color: t.accent }]} onPress={() => Linking.openURL(song.link!)}>
              Open in YouTube Music
            </Text>
          )}
        </View>
      </View>
      {msg && <Text style={s.msg}>{msg}</Text>}

      {song.alternatives.length > 0 && (
        <View style={s.card}>
          <Text style={s.label}>Not this song? Tap the right one</Text>
          {song.alternatives.map((x) => (
            <Pressable key={x.videoId} disabled={busy} onPress={() => act({ action: "swap", videoId: x.videoId })} style={{ paddingVertical: 6 }}>
              <Text style={s.body}>
                {x.title}
                {x.artist ? <Text style={s.muted}>{`  ${x.artist}`}</Text> : null}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {song.status === "writing" && (
        <View style={[s.card, { flexDirection: "row", gap: 10, alignItems: "center" }]}>
          <ActivityIndicator />
          <Text style={s.body}>
            {song.stage === "research"
              ? "Researching the song (1 of 3)..."
              : song.stage === "analysis"
                ? "Breaking down the song (2 of 3)..."
                : "Writing your version (3 of 3)..."}{" "}
            About a minute in all.
          </Text>
        </View>
      )}
      {song.status === "error" && <Text style={[s.msg, { color: t.danger }]}>{song.error ?? "Something failed."} Tap Rewrite below.</Text>}

      {suno && (
        <>
          <View style={[s.card, { gap: 8 }]}>
            <Text style={s.h2}>{`"${suno.title}"`}</Text>
            <Text style={s.muted}>
              In Suno: Create, Custom. Copy each part below and paste it in. {suno.tips}
            </Text>
            <Pressable style={[s.bigBtn, { backgroundColor: t.accent }]} onPress={() => Linking.openURL("https://suno.com/create")}>
              <Text style={[s.bigBtnText, { color: "#fff" }]}>Open Suno</Text>
            </Pressable>
          </View>
          <Copy label="Lyrics" text={suno.lyrics} />
          <Copy label="Style of Music" text={suno.style} />
          <Copy label="Title" text={suno.title} />
          <Copy label="Exclude styles" text={suno.exclude} />
        </>
      )}

      {a && (
        <View style={s.card}>
          <Text style={s.label}>{`What makes the original tick (${a.confidence})`}</Text>
          <Text style={s.body}>
            {[a.genre, ...(a.subgenres ?? [])].join(", ")}
            {a.bpm ? `, ${a.bpm} bpm` : ""}
            {a.key ? `, ${a.key}` : ""}
          </Text>
          <Text style={s.body}>Mood: {a.mood?.join(", ")}. {a.energy}</Text>
          {a.groove ? <Text style={s.body}>Groove: {a.groove}</Text> : null}
          {a.harmony ? <Text style={s.body}>Harmony: {a.harmony}</Text> : null}
          <Text style={s.body}>Vocals: {a.vocals}</Text>
          {a.vocalProduction ? <Text style={s.body}>Vocal production: {a.vocalProduction}</Text> : null}
          {a.language ? <Text style={s.body}>Language: {a.language}</Text> : null}
          {a.hook ? <Text style={s.body}>Hook: {a.hook}</Text> : null}
          <Text style={s.body}>Sound: {a.instruments?.join(", ")}. {a.production}</Text>
          <Text style={s.body}>Structure: {a.structure}</Text>
          {a.sections?.map((x, i) => (
            <Text key={i} style={s.muted}>{`${x.name}: ${x.lines} lines, ${x.syllables} syllables, rhyme ${x.rhyme}, ${x.delivery}`}</Text>
          ))}
          <Text style={s.body}>Themes: {a.themes}</Text>
          <Text style={s.muted}>{a.whyItWorks}</Text>
        </View>
      )}

      {(suno || song.status === "error") && (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Rewrite</Text>
          <TextInput
            value={direction}
            onChangeText={setDirection}
            placeholder="Optional: e.g. Afrobeats, female vocal, about leaving Lagos"
            placeholderTextColor={t.muted}
            multiline
            style={s.input}
          />
          <Pressable disabled={busy || song.status === "writing"} style={[s.bigBtn, { backgroundColor: t.navy }]} onPress={() => act({ action: "rewrite", direction })}>
            <Text style={[s.bigBtnText, { color: t.bg }]}>Write a new version</Text>
          </Pressable>
          <Pressable disabled={busy || song.status === "writing"} onPress={() => act({ action: "reanalyze", direction })}>
            <Text style={[s.muted, { textDecorationLine: "underline" }]}>Re-analyse the song first (about a minute)</Text>
          </Pressable>
        </View>
      )}

      {suno && (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Plan B: make it here with ACE-Step</Text>
          <Text style={s.muted}>Open-source song model. Two takes, 1 to 3 minutes, about 11 US cents.</Text>
          <Pressable disabled={busy || Boolean(pending)} style={[s.bigBtn, { borderColor: t.border, borderWidth: 1 }]} onPress={() => act({ action: "generate" })}>
            <Text style={[s.bigBtnText, { color: t.text }]}>{pending && song.status !== "writing" ? "Making takes..." : "Make 2 takes"}</Text>
          </Pressable>
          {song.generations.map((g) => (
            <View key={g.requestId} style={{ gap: 6 }}>
              <Text style={s.muted}>
                {new Date(g.createdAt).toLocaleString()} · {g.status}
                {g.error ? `: ${g.error}` : ""}
              </Text>
              {g.audioUrls.map((u, i) => (
                <View key={u} style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable style={[s.chip, { backgroundColor: t.navy }]} onPress={() => play(u)}>
                    <Text style={{ color: t.bg, fontWeight: "700" }}>{playing === u ? "Pause" : `Play take ${i + 1}`}</Text>
                  </Pressable>
                  <Pressable style={[s.chip, { borderColor: t.border, borderWidth: 1 }]} onPress={() => Linking.openURL(u)}>
                    <Text style={{ color: t.text }}>Save</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={() =>
          Alert.alert("Delete this song?", "It is removed from Jarvis (not from YouTube).", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                await deleteSong(id).catch(() => {});
                router.back();
              },
            },
          ])
        }
      >
        <Text style={{ color: t.danger, textAlign: "center", padding: 12 }}>Delete</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    art: { width: 76, height: 76, borderRadius: 12 },
    h1: { color: t.text, fontSize: 22, fontWeight: "700" },
    h2: { color: t.text, fontSize: 18, fontWeight: "700" },
    muted: { color: t.muted, fontSize: 13, lineHeight: 18 },
    body: { color: t.text, fontSize: 15, lineHeight: 22 },
    label: { color: t.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    msg: { color: t.text, backgroundColor: t.card, borderRadius: 12, padding: 12, fontSize: 14 },
    card: { backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
    cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    bigBtn: { borderRadius: 14, paddingVertical: 13, alignItems: "center" },
    bigBtnText: { fontWeight: "700", fontSize: 15 },
    input: { color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 60, fontSize: 15 },
  });
