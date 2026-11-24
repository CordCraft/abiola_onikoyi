import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, Stack, router } from "expo-router";
import * as Haptics from "expo-haptics";
import { createAudioPlayer } from "expo-audio";
import { addTask, getToday, synthesize, taskAction, type Today, type TodayTask, type TaskAction } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

const SECTION_TITLES: Record<TodayTask["bucket"], string> = {
  overdue: "Overdue",
  today: "Today",
  doing: "In progress",
  next: "Up next",
};

export default function TodayScreen() {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState("");
  const [undo, setUndo] = useState<{ task: TodayTask; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getToday());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
    return () => sub.remove();
  }, [load]);

  const sections = useMemo(() => {
    if (!data) return [];
    const order: TodayTask["bucket"][] = ["overdue", "today", "doing", "next"];
    return order
      .map((b) => ({ key: b, title: SECTION_TITLES[b], data: data.tasks.filter((x) => x.bucket === b) }))
      .filter((sec) => sec.data.length);
  }, [data]);

  async function act(task: TodayTask, action: TaskAction) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (action === "done") {
      // Optimistic: hide it, offer undo for a few seconds
      setData((d) => (d ? { ...d, tasks: d.tasks.filter((x) => x.id !== task.id) } : d));
      if (undo) clearTimeout(undo.timer);
      setUndo({ task, timer: setTimeout(() => setUndo(null), 5000) });
    }
    try {
      await taskAction(task.id, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    void load();
  }

  async function undoDone() {
    if (!undo) return;
    clearTimeout(undo.timer);
    setUndo(null);
    await taskAction(undo.task.id, "reopen").catch(() => {});
    void load();
  }

  function more(task: TodayTask) {
    const options: { label: string; action: TaskAction }[] = [
      { label: "Start now", action: "doing" },
      { label: "Do it today", action: "today" },
      { label: "Move to tomorrow", action: "snooze" },
      { label: task.priority === "high" ? "Normal priority" : "High priority", action: task.priority === "high" ? "medium" : "high" },
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: task.title, options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length },
      (i) => {
        if (i < options.length) void act(task, options[i].action);
      },
    );
  }

  async function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await addTask(title, "today").catch((e) => setError(String(e)));
    void load();
  }

  async function speakSummary() {
    if (!data) return;
    if (speaking) {
      playerRef.current?.pause();
      playerRef.current?.release();
      playerRef.current = null;
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      const uri = await synthesize(data.speech);
      const p = createAudioPlayer(uri);
      playerRef.current = p;
      p.addListener("playbackStatusUpdate", (st) => {
        if (st.didJustFinish) {
          p.release();
          playerRef.current = null;
          setSpeaking(false);
        }
      });
      p.play();
    } catch {
      setSpeaking(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18 }}>
              <Link href="/chat" style={s.headerLink}>Chat</Link>
              <Link href="/settings" style={s.headerLink}>Settings</Link>
            </View>
          ),
        }}
      />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
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
          <View style={s.header}>
            {data ? (
              <>
                <Text style={s.summary}>{data.speech}</Text>
                <View style={s.chips}>
                  <Chip t={t} label="due today" value={data.counts.today + data.counts.overdue} />
                  <Chip t={t} label="done" value={data.counts.doneToday} />
                  <Chip t={t} label="decisions" value={data.counts.signals} />
                </View>
              </>
            ) : error ? null : (
              <ActivityIndicator style={{ marginTop: 24 }} />
            )}
            {error && <Text style={s.error}>{error}</Text>}
            <View style={s.actions}>
              <Pressable style={[s.bigBtn, { backgroundColor: t.navy }]} onPress={() => router.push("/talk")}>
                <Text style={[s.bigBtnText, { color: t.bg }]}>Talk to Jarvis</Text>
              </Pressable>
              <Pressable style={[s.bigBtn, { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }]} onPress={speakSummary}>
                <Text style={[s.bigBtnText, { color: t.text }]}>{speaking ? "Stop" : "Read it to me"}</Text>
              </Pressable>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={s.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable style={s.row} onLongPress={() => more(item)} onPress={() => more(item)}>
            <Pressable hitSlop={12} onPress={() => act(item, "done")} style={[s.check, { borderColor: item.priority === "high" ? t.danger : t.muted }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{item.title}</Text>
              <Text style={s.meta}>
                {[item.project, item.priority === "high" ? "high priority" : null, item.status === "doing" ? "in progress" : null, item.due && item.bucket !== "today" ? `due ${item.due}` : null]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={data ? <Text style={[s.meta, { textAlign: "center", marginTop: 32 }]}>Nothing open. Enjoy it.</Text> : undefined}
        ListFooterComponent={<View style={{ height: 120 }} />}
      />
      {undo && (
        <View style={[s.toast, { backgroundColor: t.navy }]}>
          <Text style={{ color: t.bg, flex: 1 }} numberOfLines={1}>Done: {undo.task.title}</Text>
          <Pressable onPress={undoDone}>
            <Text style={{ color: t.accent, fontWeight: "700" }}>Undo</Text>
          </Pressable>
        </View>
      )}
      <View style={[s.addBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a task for today"
          placeholderTextColor={t.muted}
          style={[s.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
          returnKeyType="done"
          onSubmitEditing={add}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Chip({ t, label, value }: { t: Theme; label: string; value: number }) {
  return (
    <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    header: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
    headerLink: { color: t.accent, fontSize: 16, fontWeight: "600" },
    summary: { color: t.text, fontSize: 17, lineHeight: 24 },
    chips: { flexDirection: "row", gap: 10 },
    actions: { flexDirection: "row", gap: 10, marginBottom: 6 },
    bigBtn: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 14 },
    bigBtnText: { fontSize: 16, fontWeight: "600" },
    error: { color: t.danger },
    sectionTitle: { color: t.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6, backgroundColor: t.bg },
    row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
    title: { color: t.text, fontSize: 16 },
    meta: { color: t.muted, fontSize: 13, marginTop: 2 },
    toast: { position: "absolute", left: 16, right: 16, bottom: 84, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
    addBar: { padding: 12, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  });
