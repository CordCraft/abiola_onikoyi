export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Human pacing: a base delay with +-40% jitter, so nothing polls on a robotic beat.
export function jitter(ms, spread = 0.4) {
  return Math.round(ms * (1 - spread + Math.random() * spread * 2));
}

// Runs fn forever on a jittered interval; errors are logged, never fatal.
export function every(name, baseMs, fn, { initialDelayMs = 2000 } = {}) {
  let stopped = false;
  (async () => {
    await sleep(jitter(initialDelayMs));
    while (!stopped) {
      try { await fn(); } catch (e) { console.error(`[${name}]`, e?.message || e); }
      await sleep(jitter(typeof baseMs === 'function' ? baseMs() : baseMs));
    }
  })();
  return () => { stopped = true; };
}

export function clip(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

// Plain text from an HTML email body, good enough for triage.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// Cut quoted history out of an email reply so triage sees what is new.
export function stripQuoted(text) {
  const t = String(text || '');
  const markers = [/\nOn .{5,120}wrote:\s*\n/i, /\n-{2,}\s*Original Message\s*-{2,}/i, /\nFrom: .+\nSent: /i, /\n_{10,}\n/];
  let cut = t.length;
  for (const m of markers) {
    const i = t.search(m);
    if (i > 40 && i < cut) cut = i;
  }
  return t.slice(0, cut).trim();
}

export function minutesIn(tz, d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour').value) % 24;
  const m = Number(p.find((x) => x.type === 'minute').value);
  return h * 60 + m;
}

export function dateKeyIn(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function weekdayIn(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(d);
}

export function parseHm(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function hm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// The UTC offset (minutes) of a zone at a moment, for turning "09:30 local" into a Date.
export function tzOffsetMinutes(tz, d = new Date()) {
  const s = d.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(s);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

// ---- Task and signal hygiene helpers (pure, unit tested) ------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'about', 'your', 'you', 'our', 'his', 'her',
  'their', 'are', 'was', 'were', 'will', 'can', 'not', 'but', 'have', 'has', 'had', 'out', 'all', 'any', 'get', 'got',
  'via', 'per', 're', 'fw', 'fwd', 'please', 'pls', 'asap', 'today', 'tomorrow', 'week', 'need', 'needs',
]);

// Lowercase, strip punctuation, drop stopwords and words under 3 characters.
export function normWords(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

// Word Jaccard similarity of two titles (0..1).
export function jaccard(a, b) {
  const A = a instanceof Set ? a : normWords(a);
  const B = b instanceof Set ? b : normWords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, urgent: 3 };
export function higherPriority(a, b) {
  return (PRIORITY_RANK[b] ?? -1) > (PRIORITY_RANK[a] ?? -1) ? b : a || b;
}

// Signals fade: half their weight every 36 hours since they last changed.
export const HALF_LIFE_HOURS = 36;
export function effectiveScore(score, updatedAt, now = Date.now()) {
  const hours = Math.max(0, (now - new Date(updatedAt).getTime()) / 3600e3);
  return Number(score || 0) * Math.pow(0.5, hours / HALF_LIFE_HOURS);
}
// The same, as a SQL expression over a JarvisSignal row (optionally aliased).
export function effectiveScoreSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `(${p}score * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM (now() - ${p}"updatedAt"))) / 3600.0 / ${HALF_LIFE_HOURS}))`;
}
