import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the health + notification tables in production (deploys never run
// `prisma db push`). Keep in sync with JarvisHealthSample / JarvisWorkout /
// JarvisNotification in prisma/schema.prisma.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "JarvisHealthSample" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "day" TEXT,
    "source" TEXT,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisHealthSample_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisWorkout" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "durationMin" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "pushups" INTEGER,
    "squats" INTEGER,
    "plankSec" INTEGER,
    "rpe" INTEGER,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisWorkout_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisNotification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT,
    "tag" TEXT,
    "ref" JSONB,
    "threadId" TEXT,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisNotification_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "JarvisAppDevice" (
    "id" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "name" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisAppDevice_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisAppDevice_pushToken_key" ON "JarvisAppDevice"("pushToken")`,
  `ALTER TABLE "JarvisNotification" ADD COLUMN IF NOT EXISTS "threadId" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JarvisHealthSample_externalId_key" ON "JarvisHealthSample"("externalId")`,
  `CREATE INDEX IF NOT EXISTS "JarvisHealthSample_metric_startAt_idx" ON "JarvisHealthSample"("metric", "startAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisWorkout_day_idx" ON "JarvisWorkout"("day")`,
  `CREATE INDEX IF NOT EXISTS "JarvisNotification_tag_idx" ON "JarvisNotification"("tag")`,
  `CREATE INDEX IF NOT EXISTS "JarvisNotification_createdAt_idx" ON "JarvisNotification"("createdAt")`,
  `ALTER TABLE "JarvisHealthSample" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisWorkout" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisNotification" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "JarvisAppDevice" ENABLE ROW LEVEL SECURITY`,
];

let ensured: Promise<void> | null = null;

export function ensureCompanionTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const stmt of DDL) {
        if (stmt.includes("ROW LEVEL SECURITY") || stmt.includes("ADD COLUMN IF NOT EXISTS")) {
          // Postgres only; local SQLite test databases skip these.
          await prisma.$executeRawUnsafe(stmt).catch(() => {});
        } else await prisma.$executeRawUnsafe(stmt);
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
