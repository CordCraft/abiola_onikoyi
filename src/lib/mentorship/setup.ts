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
];

// One run per serverless instance is enough; IF NOT EXISTS keeps reruns cheap
// and concurrent cold starts safe.
let ensured: Promise<void> | null = null;

export function ensureMentorshipTables(): Promise<void> {
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
