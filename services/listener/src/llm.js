import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export const client = new Anthropic({ apiKey: config.anthropicKey });

let fallbacksOk = true;

// One structured-output call. Server-side refusal fallbacks are on by default; if the API
// ever rejects the parameter, retry once without it and stop sending it.
export async function structured({ model, system, user, schema, effort = 'medium', maxTokens = 16000 }) {
  // Test hook: integration tests stand in a fake model.
  if (globalThis.__jarvisFakeStructured) return globalThis.__jarvisFakeStructured({ model, system, user, schema });
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  let res;
  try {
    res = fallbacksOk
      ? await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(base);
  } catch (e) {
    if (fallbacksOk && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      fallbacksOk = false;
      res = await client.messages.create(base);
    } else {
      throw e;
    }
  }
  if (res.stop_reason === 'refusal') throw new Error(`model declined (${res.stop_details?.category || 'unknown'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('model output was cut off');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

// Plain text call for the planner's prose.
export async function prose({ model, system, user, effort = 'medium', maxTokens = 8000 }) {
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort },
  });
  if (res.stop_reason === 'refusal') throw new Error('model declined');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
