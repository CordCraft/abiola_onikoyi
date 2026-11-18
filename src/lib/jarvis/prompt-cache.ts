import type Anthropic from "@anthropic-ai/sdk";

// Returns a copy of the history with a cache breakpoint on the final block, so each tool-loop
// iteration (and the next chat turn) reads the previous prefix instead of paying for it again.
// Attached documents ride in the first user message and used to be re-billed in full on every
// loop. The stored turn state is left untouched. Thinking blocks cannot be marked.
export function withHistoryCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role === "system") return messages;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? last.content.trim()
        ? [{ type: "text", text: last.content }]
        : []
      : [...last.content];
  const tail = blocks[blocks.length - 1];
  if (!tail || tail.type === "thinking" || tail.type === "redacted_thinking") return messages;
  if (tail.type === "text" && !tail.text.trim()) return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

// A history window that only moves in steps of 10 messages. A plain "last 30" slides by one
// every turn, which changes the first message and so invalidates the whole cached history each
// time; this keeps the start fixed for ten turns at a time (between 21 and 30 messages kept).
export function steppedWindow<T>(items: T[], max: number, step = 10): T[] {
  if (items.length <= max) return items;
  const start = Math.ceil((items.length - max) / step) * step;
  return items.slice(start);
}
