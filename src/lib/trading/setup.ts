import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the trading tables in production. Deploys never run
// `prisma db push` automatically (the build only runs `prisma generate`), so
// the ingest endpoint and the dashboard pages call this on first use.
// Every statement is idempotent (IF NOT EXISTS) and follows Prisma's naming
// conventions exactly, so a later manual `prisma db push` reconciles cleanly.
// Keep in sync with the Trading* models in prisma/schema.prisma.

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "TradingAccount" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "label" TEXT,
    "name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "leverage" INTEGER,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "margin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freeMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginLevel" DOUBLE PRECISION,
    "floatingPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "openPositions" JSONB,
    "gmtOffsetSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradingAccount_accountKey_key" ON "TradingAccount"("accountKey")`,

  `CREATE TABLE IF NOT EXISTS "TradingDeal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "orderTicket" TEXT,
    "positionId" TEXT,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entry" TEXT NOT NULL DEFAULT '',
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sl" DOUBLE PRECISION,
    "tp" DOUBLE PRECISION,
    "profit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "swap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "magic" TEXT,
    "comment" TEXT,
    "time" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradingDeal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradingDeal_accountId_fkey" FOREIGN KEY ("accountId")
      REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradingDeal_accountId_ticket_key" ON "TradingDeal"("accountId", "ticket")`,
  `CREATE INDEX IF NOT EXISTS "TradingDeal_accountId_time_idx" ON "TradingDeal"("accountId", "time")`,
  `CREATE INDEX IF NOT EXISTS "TradingDeal_accountId_positionId_idx" ON "TradingDeal"("accountId", "positionId")`,

  `CREATE TABLE IF NOT EXISTS "TradingSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" DOUBLE PRECISION NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freeMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginLevel" DOUBLE PRECISION,
    "floatingPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "positions" JSONB,
    CONSTRAINT "TradingSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradingSnapshot_accountId_fkey" FOREIGN KEY ("accountId")
      REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "TradingSnapshot_accountId_at_idx" ON "TradingSnapshot"("accountId", "at")`,
];

// One run per serverless instance is enough; IF NOT EXISTS keeps reruns cheap
// and concurrent cold starts safe.
let ensured: Promise<void> | null = null;

export function ensureTradingTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const stmt of DDL) {
        await prisma.$executeRawUnsafe(stmt);
      }
    })().catch((err) => {
      // Allow a retry on the next request rather than caching the failure.
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
