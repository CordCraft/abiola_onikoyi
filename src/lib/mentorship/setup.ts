import "server-only";
import { prisma } from "@/lib/prisma";

// Creates the mentorship tables in production. Deploys never run
// `prisma db push` automatically (the build only runs `prisma generate`), so
// the admin mentorship area and the mentee login call this on first use.
// Every statement is idempotent (IF NOT EXISTS) and follows Prisma's naming
// conventions exactly, so a later manual `prisma db push` reconciles cleanly.
// Keep in sync with the Mentorship* models in prisma/schema.prisma.

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "MentorshipMentee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessCode" TEXT NOT NULL,
    "headline" TEXT,
    "focusArea" TEXT,
    "cohort" TEXT NOT NULL DEFAULT '2026-C1',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipMentee_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MentorshipMentee_email_key" ON "MentorshipMentee"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MentorshipMentee_accessCode_key" ON "MentorshipMentee"("accessCode")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipGoal" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targetMonth" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipGoal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipGoal_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipGoal_menteeId_status_idx" ON "MentorshipGoal"("menteeId", "status")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipTask" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "goalId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'mentor',
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'todo',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipTask_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MentorshipTask_goalId_fkey" FOREIGN KEY ("goalId")
      REFERENCES "MentorshipGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipTask_menteeId_status_idx" ON "MentorshipTask"("menteeId", "status")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipCheckin" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "wins" TEXT NOT NULL,
    "blockers" TEXT,
    "nextFocus" TEXT,
    "confidence" INTEGER,
    "mentorReply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipCheckin_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipCheckin_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipCheckin_menteeId_week_idx" ON "MentorshipCheckin"("menteeId", "week")`,
  `CREATE INDEX IF NOT EXISTS "MentorshipCheckin_createdAt_idx" ON "MentorshipCheckin"("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipMessage" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "MentorshipMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipMessage_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipMessage_menteeId_createdAt_idx" ON "MentorshipMessage"("menteeId", "createdAt")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'group',
    "menteeId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "link" TEXT,
    "agenda" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipSession_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipSession_scheduledAt_idx" ON "MentorshipSession"("scheduledAt")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipResource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "note" TEXT,
    "category" TEXT NOT NULL DEFAULT 'reading',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipResource_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "MentorshipAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipAnnouncement_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "MentorshipPlanDay" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "week" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mindset" TEXT,
    "completedAt" TIMESTAMP(3),
    "reflection" TEXT,
    "confidence" INTEGER,
    "mentorComment" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipPlanDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipPlanDay_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MentorshipPlanDay_menteeId_dayIndex_key" ON "MentorshipPlanDay"("menteeId", "dayIndex")`,
  `CREATE INDEX IF NOT EXISTS "MentorshipPlanDay_menteeId_date_idx" ON "MentorshipPlanDay"("menteeId", "date")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipPlanTask" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'skill',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "points" INTEGER NOT NULL DEFAULT 10,
    "evidenceHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "completedAt" TIMESTAMP(3),
    "evidence" TEXT,
    "mentorComment" TEXT,
    CONSTRAINT "MentorshipPlanTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipPlanTask_dayId_fkey" FOREIGN KEY ("dayId")
      REFERENCES "MentorshipPlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "MentorshipPlanTask_menteeId_status_idx" ON "MentorshipPlanTask"("menteeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "MentorshipPlanTask_dayId_order_idx" ON "MentorshipPlanTask"("dayId", "order")`,

  `CREATE TABLE IF NOT EXISTS "MentorshipAiTool" (
    "id" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "apiKey" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentorshipAiTool_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MentorshipAiTool_menteeId_fkey" FOREIGN KEY ("menteeId")
      REFERENCES "MentorshipMentee"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MentorshipAiTool_menteeId_tool_key" ON "MentorshipAiTool"("menteeId", "tool")`,
];

// Columns added after the initial launch. CREATE TABLE IF NOT EXISTS skips
// existing tables, so later additions must arrive as ALTERs. Postgres supports
// ADD COLUMN IF NOT EXISTS; each statement is tried independently and failures
// are swallowed (local SQLite dev gets its columns from `prisma db push`).
const MENTEE_PROFILE_COLUMNS = [
  "passwordHash",
  "onboardedAt",
  "photoData",
  "phone",
  "linkedin",
  "level",
  "gradYear",
  "interests",
  "backgroundStory",
  "skills",
  "dreamRoles",
  "aspirations",
  "longTermVision",
  "expectations",
  "challenges",
  "availability",
  "commsPref",
];

// Applies only the ALTERs that are actually needed (Postgres). Returns true
// when any column was added. Throws on SQLite (no information_schema), which
// the caller treats as "columns come from prisma db push".
async function applyColumnMigrations(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'MentorshipMentee'`,
  );
  const existing = new Set(rows.map((r) => r.column_name));
  const missing = MENTEE_PROFILE_COLUMNS.filter((c) => !existing.has(c));
  for (const col of missing) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MentorshipMentee" ADD COLUMN IF NOT EXISTS "${col}" ${
        col === "onboardedAt" ? "TIMESTAMP(3)" : "TEXT"
      }`,
    );
  }
  return missing.length > 0;
}

// One run per serverless instance is enough; IF NOT EXISTS keeps reruns cheap
// and concurrent cold starts safe.
let ensured: Promise<void> | null = null;

export function ensureMentorshipTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const stmt of DDL) {
        await prisma.$executeRawUnsafe(stmt);
      }
      let altered = false;
      try {
        altered = await applyColumnMigrations();
      } catch {
        // Non-Postgres local dev: columns come from `prisma db push`.
      }
      if (altered) {
        // Pooled Postgres connections cache prepared statements; after an
        // ALTER they can fail with "cached plan must not change result type".
        // Dropping the pool forces fresh connections with correct plans.
        await prisma.$disconnect().catch(() => {});
      }
    })().catch((err) => {
      // Allow a retry on the next request rather than caching the failure.
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
