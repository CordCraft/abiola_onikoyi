import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { likeSong, listSongs, type Song } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

// Songs you liked (Control Center heart, Siri, or a YouTube Music link) and
// the Suno packs Jarvis wrote for them.
export default function SongsScreen() {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSongs(await listSongs());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load songs");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Poll while Jarvis is still writing something
  useEffect(() => {
    if (!songs?.some((x) => x.status === "writing")) return;
    const timer = setTimeout(() => void load(), 4000);
    return () => clearTimeout(timer);
  }, [songs, load]);

  const like = async (url?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await likeSong(url ? { url, source: "link" } : {});
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg(r.speech);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save the song");
    }
    setBusy(false);
  };

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={songs ?? []}
      keyExtractor={(x) => x.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 6 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable disabled={busy} style={[s.btn, { backgroundColor: t.navy, flex: 1 }]} onPress={() => like()}>
              <Text style={[s.btnText, { color: t.bg }]}>{busy ? "Saving..." : "♥ Like what's playing"}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              style={[s.btn, { borderColor: t.border, borderWidth: 1 }]}
              onPress={async () => {
                const text = (await Clipboard.getStringAsync()).trim();
                if (!/youtu/.test(text)) {
                  setMsg("Copy a YouTube Music link first: in YouTube Music, Share, Copy link.");
                  return;
                }
                await like(text);
              }}
            >
              <Text style={[s.btnText, { color: t.text }]}>Paste link</Text>
            </Pressable>
          </View>
          {msg && <Text style={s.msg}>{msg}</Text>}
          {songs === null && <ActivityIndicator />}
          {songs?.length === 0 && (
            <Text style={s.muted}>
              Nothing yet. Swipe down from the top right while YouTube Music plays and tap the heart. Add it first: Control Center, +, Add a Control, Jarvis, Like this song.
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={s.row} onPress={() => router.push(`/songs/${item.id}`)}>
          {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={s.thumb} /> : <View style={[s.thumb, s.noThumb]}><Text style={{ color: t.muted }}>♪</Text></View>}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.title} numberOfLines={1}>{item.title}</Text>
            <Text style={s.muted} numberOfLines={1}>
              {item.artist ?? "Unknown artist"}
              {" · "}
              {item.status === "writing" ? (item.stage === "research" ? "researching the song..." : item.stage === "analysis" ? "breaking it down..." : "writing your version...") : item.status === "error" ? "needs a rewrite" : item.suno ? `"${item.suno.title}"` : "saved"}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    btn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" },
    btnText: { fontWeight: "700", fontSize: 15 },
    msg: { color: t.text, backgroundColor: t.card, borderRadius: 12, padding: 12, fontSize: 14 },
    muted: { color: t.muted, fontSize: 13 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 10 },
    thumb: { width: 52, height: 52, borderRadius: 10 },
    noThumb: { backgroundColor: t.border, alignItems: "center", justifyContent: "center" },
    title: { color: t.text, fontSize: 16, fontWeight: "600" },
  });
