// WhatsApp on the owner's own number, linked as a device (like WhatsApp Desktop) through Baileys.
// It behaves like a quiet, human client:
// - never marks itself online (so the phone keeps its normal notifications)
// - never sends read receipts (messages stay unread on the phone until the owner reads them)
// - never pulls full history; it only hears what arrives from now on
// - looks up group names lazily and slowly, one at a time, cached for hours
// - sends only approved messages, with a typing pause first, and a daily cap
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, { downloadMediaMessage, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from 'baileys';
import { config } from './config.js';
import { storeInbound } from './accounts.js';
import { q, one, newId, setSetting, getSetting } from './db.js';
import { sleep, jitter, clip, dateKeyIn } from './util.js';
import { transcribe } from './voice.js';

const digits = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function unwrap(msg) {
  if (!msg) return null;
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg.editedMessage?.message;
  return inner ? unwrap(inner) : msg;
}

function textOf(msg) {
  return (
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    (msg?.documentMessage ? `[document] ${msg.documentMessage.fileName || ''} ${msg.documentMessage.caption || ''}`.trim() : '') ||
    (msg?.locationMessage ? `[location] ${msg.locationMessage.name || ''} ${msg.locationMessage.address || ''}`.trim() : '') ||
    (msg?.contactMessage ? `[contact card] ${msg.contactMessage.displayName || ''}` : '') ||
    ''
  ).trim();
}

export class WhatsApp {
  constructor() {
    this.authDir = path.join(config.dataDir, 'wa-auth');
    this.sock = null;
    this.state = 'starting';
    this.groupNames = new Map(); // jid -> { name, at }
    this.groupQueue = Promise.resolve();
    this.names = new Map(); // jid -> push name
    this.voiceQueue = Promise.resolve();
    this.restarting = false;
  }

  async publishStatus(extra = {}) {
    const status = { state: this.state, account: this.account || null, updatedAt: new Date().toISOString(), ...extra };
    await setSetting('whatsapp_status', status).catch(() => {});
    await q(
      `INSERT INTO "JarvisConnection" (id, provider, account, label, purpose, status, "lastSyncAt", "updatedAt")
       VALUES ($1, 'whatsapp', $2, 'WhatsApp', 'personal', $3, now(), now())
       ON CONFLICT (provider, account) DO UPDATE SET status = EXCLUDED.status, "lastSyncAt" = now(), "updatedAt" = now()`,
      [newId(), this.account || 'pending', this.state === 'open' ? 'active' : this.state === 'logged_out' ? 'needs_reauth' : 'paused'],
    ).catch(() => {});
  }

  async start() {
    if (!config.whatsapp.enabled) {
      this.state = 'disabled';
      return;
    }
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS('Chrome'), // standard name: pairing codes only work with one
      logger: pino({ level: 'warn' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
    });
    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        this.state = 'pairing';
        const qrSvg = await QRCode.toString(u.qr, { type: 'svg', margin: 1 }).catch(() => null);
        let pairingCode = null;
        if (config.whatsapp.number && !sock.authState.creds.registered && !this.pairingCode) {
          try {
            this.pairingCode = pairingCode = await sock.requestPairingCode(config.whatsapp.number);
          } catch (e) {
            console.error('[whatsapp] pairing code failed:', e.message);
          }
        }
        await this.publishStatus({ qrSvg, pairingCode: pairingCode || this.pairingCode || null });
      }
      if (u.connection === 'open') {
        this.state = 'open';
        this.pairingCode = null;
        this.account = digits(sock.user?.id);
        console.log(`[whatsapp] connected as ${this.account}`);
        await this.publishStatus();
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          this.state = 'logged_out';
          console.log('[whatsapp] logged out (link removed on the phone); waiting for a new pairing');
          fs.rmSync(this.authDir, { recursive: true, force: true });
        } else {
          this.state = 'closed';
          if (!sock.authState.creds.registered) this.pairingCode = null;
        }
        await this.publishStatus();
        // Reconnect like a person reopening the app: not instantly, not on a fixed beat.
        if (!this.restarting) {
          this.restarting = true;
          setTimeout(() => {
            this.restarting = false;
            this.start().catch((e) => console.error('[whatsapp] restart failed', e.message));
          }, jitter(code === DisconnectReason.loggedOut ? 5000 : 8000));
        }
      }
    });

    sock.ev.on('contacts.upsert', (cs) => {
      for (const c of cs || []) if (c.id && (c.name || c.notify)) this.names.set(c.id, c.name || c.notify);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const m of messages) await this.onMessage(m).catch((e) => console.error('[whatsapp] message', e.message));
    });
  }

  // Group names, fetched one at a time with a pause, cached for 12 hours.
  groupName(jid) {
    const cached = this.groupNames.get(jid);
    if (cached && Date.now() - cached.at < 12 * 3600e3) return Promise.resolve(cached.name);
    const p = this.groupQueue.then(async () => {
      const again = this.groupNames.get(jid);
      if (again && Date.now() - again.at < 12 * 3600e3) return again.name;
      await sleep(jitter(2500));
      const meta = await this.sock.groupMetadata(jid).catch(() => null);
      const name = meta?.subject || 'Group';
      this.groupNames.set(jid, { name, at: Date.now() });
      return name;
    });
    this.groupQueue = p.catch(() => {});
    return p;
  }

  async onMessage(m) {
    const jid = m.key?.remoteJid || '';
    if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return;
    const msg = unwrap(m.message);
    if (!msg || msg.protocolMessage || msg.reactionMessage || msg.senderKeyDistributionMessage && Object.keys(msg).length === 1) return;
    const isGroup = jid.endsWith('@g.us');
    const fromMe = !!m.key.fromMe;
    const senderJid = isGroup ? m.key.participantPn || m.key.participant || '' : m.key.remoteJidAlt || jid;
    const sender = fromMe ? this.account : digits(senderJid) || digits(jid);
    if (m.pushName && !fromMe) this.names.set(senderJid || jid, m.pushName);
    const occurredAt = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : new Date();
    const chatName = isGroup ? await this.groupName(jid) : this.names.get(m.key.remoteJidAlt || jid) || m.pushName || null;

    let body = textOf(msg);
    let kind = 'text';
    if (!body && msg.audioMessage) {
      kind = 'voice';
      body = await this.transcribeVoice(m, msg.audioMessage);
    } else if (!body && msg.imageMessage) {
      body = '[photo, no caption]';
    } else if (!body && (msg.videoMessage || msg.ptvMessage)) {
      body = '[video, no caption]';
    } else if (!body && msg.stickerMessage) {
      return;
    }
    if (!body) return;

    await storeInbound({
      source: 'whatsapp',
      externalId: `wa:${m.key.id}:${jid}`,
      threadKey: `wa:${jid}`,
      direction: fromMe ? 'out' : 'in',
      sender,
      senderName: fromMe ? 'Me' : m.pushName || this.names.get(senderJid) || sender,
      subject: kind === 'voice' ? 'Voice note' : null,
      body,
      isGroup,
      chatName,
      occurredAt,
    });
  }

  // Voice notes go through the same Whisper service as the app; one at a time.
  transcribeVoice(m, audio) {
    const seconds = Number(audio.seconds || 0);
    if (seconds > 600) return Promise.resolve(`[voice note, ${Math.round(seconds / 60)} min, too long to transcribe]`);
    const p = this.voiceQueue.then(async () => {
      try {
        const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: this.sock.logger, reuploadRequest: this.sock.updateMediaMessage });
        const text = await transcribe(buf, audio.mimetype || 'audio/ogg');
        return text ? `[voice note] ${text}` : `[voice note, ${seconds}s, could not transcribe]`;
      } catch (e) {
        console.error('[whatsapp] voice note', e.message);
        return `[voice note, ${seconds}s]`;
      }
    });
    this.voiceQueue = p.catch(() => {});
    return p;
  }

  // Send an approved message. Only to chats that already exist in Jarvis's history,
  // with a typing pause that matches the length, and a daily cap.
  async send(jid, text) {
    if (this.state !== 'open' || !this.sock) throw new Error('WhatsApp is not connected');
    const known = await one(`SELECT 1 AS ok FROM "JarvisInbound" WHERE "threadKey" = $1 LIMIT 1`, [`wa:${jid}`]);
    if (!known) throw new Error('Jarvis only replies in chats it has seen');
    const day = dateKeyIn(config.defaultTz);
    const counter = (await getSetting('whatsapp_sends', {})) || {};
    const sentToday = counter.day === day ? counter.count : 0;
    if (sentToday >= config.whatsapp.maxSendsPerDay) throw new Error('daily WhatsApp send limit reached');
    await this.sock.presenceSubscribe(jid).catch(() => {});
    await sleep(jitter(1200));
    await this.sock.sendPresenceUpdate('composing', jid).catch(() => {});
    await sleep(Math.min(9000, 1500 + clip(text, 600).length * 45) * (0.8 + Math.random() * 0.4));
    await this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
    const res = await this.sock.sendMessage(jid, { text });
    await setSetting('whatsapp_sends', { day, count: sentToday + 1 });
    return { id: res?.key?.id || null };
  }

  async logout() {
    await this.sock?.logout().catch(() => {});
    fs.rmSync(this.authDir, { recursive: true, force: true });
  }
}
