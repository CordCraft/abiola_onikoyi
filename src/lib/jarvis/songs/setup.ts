import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the JarvisSong table in production (deploys never run `prisma db
// push`). Keep in sync with JarvisSong in prisma/schema.prisma.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "JarvisSong" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "thumbnail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'control',
    "status" TEXT NOT NULL DEFAULT 'saved',
    "alternatives" JSONB,
    "analysis" JSONB,
    "suno" JSONB,
    "direction" TEXT,
    "playlistStatus" TEXT,
    "generations" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JarvisSong_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "JarvisSong_createdAt_idx" ON "JarvisSong"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "JarvisSong_videoId_idx" ON "JarvisSong"("videoId")`,
  `ALTER TABLE "JarvisSong" ADD COLUMN IF NOT EXISTS "stage" TEXT`,
  `ALTER TABLE "JarvisSong" ADD COLUMN IF NOT EXISTS "research" JSONB`,
  `ALTER TABLE "JarvisSong" ENABLE ROW LEVEL SECURITY`,
];

let ensured: Promise<void> | null = null;

export function ensureSongTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const stmt of DDL) {
        if (stmt.includes("ROW LEVEL SECURITY")) await prisma.$executeRawUnsafe(stmt).catch(() => {});
        else await prisma.$executeRawUnsafe(stmt);
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
