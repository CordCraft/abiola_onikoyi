import "server-only";
import { prisma } from "@/lib/prisma";

// Full data export payload, shared by the user-facing download and the weekly
// automated backup.
export async function buildExportPayload() {
  const [ventures, projects, tasks, notes, decisions, goals, milestones, documents, threads, messages] =
    await Promise.all([
      prisma.jarvisVenture.findMany(),
      prisma.jarvisProject.findMany(),
      prisma.jarvisTask.findMany(),
      prisma.jarvisNote.findMany(),
      prisma.jarvisDecision.findMany(),
      prisma.jarvisGoal.findMany(),
      prisma.jarvisMilestone.findMany(),
      prisma.jarvisDocument.findMany(),
      prisma.jarvisThread.findMany(),
      prisma.jarvisMessage.findMany(),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    site: "abiolaonikoyi.com/jarvis",
    ventures,
    projects,
    tasks,
    notes,
    decisions,
    goals,
    milestones,
    documents,
    threads,
    messages,
  };
}
