import "server-only";
import { prisma } from "@/lib/prisma";
import type { JarvisConnection } from "@prisma/client";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { encrypt, decrypt } from "@/lib/jarvis/v2/crypto";

// Connected Google and Microsoft accounts. The OAuth dance happens on the site
// (/jarvis/api/connect/*); the Railway listener reads the same rows to watch mail.

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
];
// Mail.Read.Shared and Mail.Send.Shared let Jarvis read and answer shared mailboxes
// (for example ceo@hoppertax.com) that the signed-in user has Full Access to.
export const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Mail.Read.Shared",
  "Mail.Send.Shared",
  "Calendars.ReadWrite",
];

export function siteOrigin(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  if (req) {
    const u = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") || u.host;
    const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return "https://abiolaonikoyi.com";
}

export async function listConnections(): Promise<JarvisConnection[]> {
  await ensureV2Tables();
  return prisma.jarvisConnection.findMany({ orderBy: [{ provider: "asc" }, { createdAt: "asc" }] });
}

export async function saveConnection(input: {
  provider: "google" | "microsoft";
  account: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number;
  scopes: string;
}) {
  await ensureV2Tables();
  const existing = await prisma.jarvisConnection.findUnique({
    where: { provider_account: { provider: input.provider, account: input.account } },
  });
  const data = {
    accessTokenEnc: encrypt(input.accessToken),
    expiresAt: new Date(Date.now() + (input.expiresIn ?? 3600) * 1000),
    scopes: input.scopes,
    status: "active",
    lastError: null,
    ...(input.refreshToken ? { refreshTokenEnc: encrypt(input.refreshToken) } : {}),
  };
  if (existing) {
    return prisma.jarvisConnection.update({ where: { id: existing.id }, data });
  }
  return prisma.jarvisConnection.create({
    data: {
      provider: input.provider,
      account: input.account,
      label: input.account,
      // Microsoft 365 is the official/work side by default; Gmail is personal.
      purpose: input.provider === "microsoft" ? "work" : "personal",
      ...data,
    },
  });
}

const TOKEN_URLS = {
  google: "https://oauth2.googleapis.com/token",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
} as const;

export async function accessToken(conn: JarvisConnection): Promise<string> {
  if (conn.accessTokenEnc && conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 120_000) {
    return decrypt(conn.accessTokenEnc)!;
  }
  const refresh = decrypt(conn.refreshTokenEnc);
  if (!refresh) throw new Error(`No refresh token for ${conn.account}; reconnect it.`);
  const isGoogle = conn.provider === "google";
  const body = new URLSearchParams({
    client_id: (isGoogle ? process.env.GOOGLE_CLIENT_ID : process.env.MS_CLIENT_ID) || "",
    client_secret: (isGoogle ? process.env.GOOGLE_CLIENT_SECRET : process.env.MS_CLIENT_SECRET) || "",
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  if (!isGoogle) body.set("scope", conn.scopes || MICROSOFT_SCOPES.join(" "));
  const res = await fetch(TOKEN_URLS[conn.provider as "google" | "microsoft"], { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    await prisma.jarvisConnection.update({
      where: { id: conn.id },
      data: { status: json.error === "invalid_grant" ? "needs_reauth" : "error", lastError: `token refresh: ${json.error ?? res.status}` },
    });
    throw new Error(`Token refresh failed for ${conn.account}`);
  }
  await prisma.jarvisConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encrypt(json.access_token),
      expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
      ...(json.refresh_token ? { refreshTokenEnc: encrypt(json.refresh_token) } : {}),
    },
  });
  return json.access_token;
}

export async function providerFetch<T = unknown>(conn: JarvisConnection, url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(conn);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${conn.provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}
