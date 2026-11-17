// Cheap, model-free decisions that keep the listener from paying for messages that cannot matter.
// Everything here is pure so it can be unit tested without a database or an API key.

// Strong signs that a message may need action. These bypass the cheap model gate (recall first).
export const ACTION_HINT = new RegExp(
  [
    '\\b\\d{1,2}(:\\d{2})?\\s?(am|pm)\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
    '\\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\\b',
    '\\b(tomorrow|tonight|today|next week|this week|deadline|urgent|asap|reminder)\\b',
    '\\b(meeting|meet|call|appointment|flight|itinerary|booking|boarding|visa|interview|schedule|reschedule)\\b',
    '\\b(invoice|payment|pay|paid|transfer|receipt|quote|quotation|proposal|contract|agreement|tender|bid|offer|po|purchase order)\\b',
    '(\\$|usd|ngn|sar|kwd|bhd|eur|gbp|naira|₦)\\s?\\d',
    '\\b\\d+(\\.\\d+)?\\s?(k|m|million|billion)\\b',
    '\\b(i will|i\'ll|i can|let me|will send|will do|remind me)\\b',
    '\\b(sign|approve|confirm|review|submit|deliver|collect|pickup|pick up)\\b',
  ].join('|'),
  'i',
);

const ACK = /^(ok(ay)?|k+|kk|thanks?( you| so much)?|thx|ty|noted|got it|lol|lmao|haha+|hehe+|amen|yes|no|yeah|yep|yup|nope|cool|great|nice|good (morning|night|evening|afternoon)|gm|gn|hi|hello|hey|hola|alright|sure|fine|welcome|you're welcome|congrats|congratulations|wow|true|exactly|indeed|hmm+|oh|ah|ooh)[\s!.,?\p{Extended_Pictographic}‍️]*$/iu;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{P}\p{S}\s‍️\u{1F3FB}-\u{1F3FF}]+$/u;
const MEDIA_PLACEHOLDER = /^\[(photo|video|image|sticker|gif)(, no caption)?\]$/i;
const OTP_WORDS = /\b(otp|one[- ]time (password|code|pin)|verification code|security code|passcode|confirmation code|login code|your code is)\b/i;
const AUTOMATED_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounces?|newsletters?|marketing|promo(tions?)?|news|updates?|notifications?|noreply\+.*)@/i;

// Returns a short reason when the message needs no model at all, else null.
export function prefilterReason(m) {
  const body = String(m.body || '').trim();
  if (!body) return 'empty';
  if (MEDIA_PLACEHOLDER.test(body)) return 'media-no-caption';
  const hinted = ACTION_HINT.test(body) || ACTION_HINT.test(String(m.subject || ''));
  if (body.length <= 2) return 'too-short';
  if (body.length <= 40 && (ACK.test(body) || EMOJI_ONLY.test(body))) return 'acknowledgement';
  if (OTP_WORDS.test(body) && /\b\d{4,8}\b/.test(body) && body.length < 300) return 'otp';
  if ((m.source === 'gmail' || m.source === 'outlook') && m.direction !== 'out' && AUTOMATED_SENDER.test(String(m.sender || '')) && !hinted) {
    return 'automated-sender';
  }
  // Short group chatter that is not about a date, money or a promise.
  if (m.isGroup && m.direction !== 'out' && body.length < 30 && !hinted) return 'group-chatter';
  return null;
}

// True when the message should go to the main model without asking the cheap gate.
export function mustKeep(m, importantSenders) {
  const text = `${m.subject || ''}\n${m.body || ''}`;
  if (ACTION_HINT.test(text)) return true;
  if (!m.isGroup && m.direction !== 'out' && importantSenders?.has(String(m.sender || '').toLowerCase())) return true;
  if (m.subject === 'Voice note') return true;
  return false;
}

// Urgent messages skip the wait before the main model: someone important wrote to him directly.
export function isUrgent(m, importantSenders) {
  return !m.isGroup && m.direction !== 'out' && importantSenders?.has(String(m.sender || '').toLowerCase());
}

// Should the pending (gated-in) messages go to the main model now?
export function shouldTriageNow({ count, oldestAgeMs, urgent, minBatch, maxWaitMs }) {
  if (!count) return false;
  if (urgent) return true;
  if (count >= minBatch) return true;
  return oldestAgeMs >= maxWaitMs;
}

// Hourly call cap, so a loop or a flood can never run the bill up silently.
export function makeLimiter(maxPerHour, now = () => Date.now()) {
  const stamps = [];
  return {
    allow() {
      const cutoff = now() - 3600e3;
      while (stamps.length && stamps[0] < cutoff) stamps.shift();
      return stamps.length < maxPerHour;
    },
    record() {
      stamps.push(now());
    },
    used() {
      const cutoff = now() - 3600e3;
      return stamps.filter((s) => s >= cutoff).length;
    },
  };
}
