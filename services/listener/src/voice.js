import { config } from './config.js';

// WhatsApp voice notes are transcribed by the Jarvis voice service (faster-whisper).
export async function transcribe(buf, mime = 'audio/ogg') {
  if (!config.voiceUrl) return '';
  const ext = /mp4|m4a|aac/.test(mime) ? 'm4a' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : 'ogg';
  const form = new FormData();
  form.append('audio', new Blob([buf], { type: mime }), `voice.${ext}`);
  const res = await fetch(`${config.voiceUrl}/stt`, { method: 'POST', headers: { 'x-voice-secret': config.voiceSecret }, body: form });
  if (!res.ok) throw new Error(`voice service ${res.status}`);
  const json = await res.json();
  return String(json.text || '').trim();
}
