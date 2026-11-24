import { useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { chat } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

type Msg = { id: string; role: "user" | "assistant"; text: string; notes?: string[] };

// Text chat with the same Jarvis brain and tools as the website.
export default function ChatScreen() {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const threadId = useRef<string | undefined>(undefined);
  const list = useRef<FlatList<Msg>>(null);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    const replyId = `a${Date.now()}`;
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: "user", text }, { id: replyId, role: "assistant", text: "" }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === replyId ? fn(m) : m)));
    try {
      const res = await chat({ message: text, threadId: threadId.current }, (e) => {
        if (e.type === "delta") patch((m) => ({ ...m, text: m.text + e.text }));
        if (e.type === "status") setStatus(e.text);
        if (e.type === "saved") patch((m) => ({ ...m, notes: [...(m.notes ?? []), e.record.summary] }));
      });
      threadId.current = res.threadId ?? threadId.current;
      patch((m) => ({ ...m, text: res.reply || m.text }));
    } catch (e) {
      patch((m) => ({ ...m, text: `Sorry, that failed: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={100}>
      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={[s.empty]}>Ask anything. Jarvis can add, finish and reorder tasks, check your day and search your notes.</Text>}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === "user" ? s.user : s.bot]}>
            <Text style={item.role === "user" ? s.userText : s.botText}>{item.text || "..."}</Text>
            {item.notes?.map((n, i) => (
              <Text key={i} style={s.note}>✓ {n}</Text>
            ))}
          </View>
        )}
      />
      {status ? <Text style={[s.empty, { paddingVertical: 4 }]}>{status}</Text> : null}
      <View style={s.bar}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Jarvis"
          placeholderTextColor={t.muted}
          style={s.input}
          multiline
        />
        <Pressable onPress={send} disabled={busy} style={[s.send, { opacity: busy ? 0.5 : 1 }]}>
          <Text style={{ color: t.bg, fontWeight: "700" }}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    empty: { color: t.muted, textAlign: "center", paddingHorizontal: 24, marginTop: 24 },
    bubble: { padding: 12, borderRadius: 16, maxWidth: "88%" },
    user: { alignSelf: "flex-end", backgroundColor: t.navy },
    bot: { alignSelf: "flex-start", backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
    userText: { color: t.bg, fontSize: 16 },
    botText: { color: t.text, fontSize: 16, lineHeight: 22 },
    note: { color: t.accent, fontSize: 13, marginTop: 6 },
    bar: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    input: { flex: 1, color: t.text, backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, maxHeight: 140 },
    send: { backgroundColor: t.navy, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  });
