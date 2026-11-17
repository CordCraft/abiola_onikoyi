import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export const client = new Anthropic({ apiKey: config.anthropicKey });

let fallbacksOk = true;

// USD per million tokens: input, output, cache read, cache write (5 minute). Used only for the
// running estimate on /health; the Anthropic console stays the source of truth.
const PRICES = {
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

// Per-label usage since the service started, so the next cost question is answered from
// real numbers (served on /health, one log line per call).
export const usageStats = {};

export function recordUsage(label, model, usage) {
  if (!usage) return;
  const s = (usageStats[label] ||= { model, calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0 });
  const input = usage.input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const out = usage.output_tokens || 0;
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  const usd = (input * p[0] + out * p[1] + read * p[2] + write * p[3]) / 1e6;
  s.calls += 1;
  s.input += input;
  s.cacheRead += read;
  s.cacheWrite += write;
  s.output += out;
  s.usd = Math.round((s.usd + usd) * 10000) / 10000;
  console.log(`[llm] ${label} ${model} in=${input} cacheRead=${read} cacheWrite=${write} out=${out} ~$${usd.toFixed(4)}`);
}

// One structured-output call. Server-side refusal fallbacks are on by default (not for the
// cheap gate model, which has none); if the API ever rejects the parameter, retry once
// without it and stop sending it.
export async function structured({ model, system, user, schema, effort = 'medium', maxTokens = 8000, label = 'structured', fallback = true }) {
  // Test hook: integration tests stand in a fake model.
  if (globalThis.__jarvisFakeStructured) return globalThis.__jarvisFakeStructured({ model, system, user, schema, label });
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  let res;
  try {
    res = fallback && fallbacksOk
      ? await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(base);
  } catch (e) {
    if (fallback && fallbacksOk && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      fallbacksOk = false;
      res = await client.messages.create(base);
    } else {
      throw e;
    }
  }
  recordUsage(label, model, res.usage);
  if (res.stop_reason === 'refusal') throw new Error(`model declined (${res.stop_details?.category || 'unknown'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('model output was cut off');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

// Plain text call for the planner's prose.
export async function prose({ model, system, user, effort = 'medium', maxTokens = 8000, label = 'prose' }) {
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort },
  });
  recordUsage(label, model, res.usage);
  if (res.stop_reason === 'refusal') throw new Error('model declined');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
