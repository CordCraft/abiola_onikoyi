import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the sync tables in production (deploys never run `prisma db push`).
// Idempotent and named exactly as Prisma would, so a later manual push
// reconciles cleanly. Keep in sync with JarvisActivity / JarvisSourceLink.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "JarvisActivity" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "state" TEXT,
    "projectId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisActivity_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisActivity_externalId_key" ON "JarvisActivity"("externalId")`,
  `CREATE INDEX IF NOT EXISTS "JarvisActivity_occurredAt_idx" ON "JarvisActivity"("occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisActivity_projectId_occurredAt_idx" ON "JarvisActivity"("projectId", "occurredAt")`,
  `CREATE TABLE IF NOT EXISTS "JarvisSourceLink" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisSourceLink_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisSourceLink_source_subject_key" ON "JarvisSourceLink"("source", "subject")`,
  // Supabase Data API must expose nothing; Prisma connects as postgres and bypasses RLS.
  `ALTER TABLE "JarvisActivity" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisSourceLink" ENABLE ROW LEVEL SECURITY`,
];

let ensured: Promise<void> | null = null;

export function ensureSyncTables(): Promise<void> {
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
