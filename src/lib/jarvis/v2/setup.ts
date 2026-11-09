import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the Jarvis v2 tables in production (deploys never run `prisma db push`).
// Generated from the JarvisConnection / Inbound / Signal / Job / Person /
// Passkey / Machine models with `prisma migrate diff`; keep in sync with them.
// The Railway listener writes these tables too, so updatedAt has a DB default.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "JarvisConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "label" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'personal',
    "scopes" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "cursor" TEXT,
    "calendarCursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisConnection_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisInbound" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "connectionId" TEXT,
    "externalId" TEXT NOT NULL,
    "threadKey" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "sender" TEXT,
    "senderName" TEXT,
    "recipients" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "chatName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "triagedAt" TIMESTAMP(3),
    "triage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisInbound_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisSignal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "why" TEXT,
    "score" INTEGER NOT NULL DEFAULT 50,
    "source" TEXT,
    "inboundIds" JSONB,
    "projectId" TEXT,
    "personKey" TEXT,
    "action" JSONB,
    "autonomy" TEXT NOT NULL DEFAULT 'ask',
    "status" TEXT NOT NULL DEFAULT 'new',
    "result" JSONB,
    "dueAt" TIMESTAMP(3),
    "snoozeUntil" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisSignal_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'listener',
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JarvisJob_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisPerson" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "relation" TEXT,
    "org" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 30,
    "projectId" TEXT,
    "notes" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "openLoops" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisPerson_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisPasskey" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "JarvisPasskey_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisMachine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "os" TEXT,
    "secretHash" TEXT NOT NULL,
    "status" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisMachine_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisConnection_provider_account_key" ON "JarvisConnection"("provider", "account")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisInbound_externalId_key" ON "JarvisInbound"("externalId")`,
  `CREATE INDEX IF NOT EXISTS "JarvisInbound_triagedAt_occurredAt_idx" ON "JarvisInbound"("triagedAt", "occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisInbound_threadKey_occurredAt_idx" ON "JarvisInbound"("threadKey", "occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisSignal_status_score_idx" ON "JarvisSignal"("status", "score")`,
  `CREATE INDEX IF NOT EXISTS "JarvisSignal_createdAt_idx" ON "JarvisSignal"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisJob_target_status_createdAt_idx" ON "JarvisJob"("target", "status", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisPerson_key_key" ON "JarvisPerson"("key")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisPasskey_credentialId_key" ON "JarvisPasskey"("credentialId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisMachine_name_key" ON "JarvisMachine"("name")`,
  `ALTER TABLE "JarvisConnection" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisInbound" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisSignal" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisJob" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisPerson" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisPasskey" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisMachine" ENABLE ROW LEVEL SECURITY`,
];

let ensured: Promise<void> | null = null;

export function ensureV2Tables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const stmt of DDL) await prisma.$executeRawUnsafe(stmt);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
