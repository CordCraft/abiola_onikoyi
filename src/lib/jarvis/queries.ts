import "server-only";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";

export * from "@/lib/jarvis/constants";

// Neon's free tier suspends when idle; the first query after a wake can fail.
// One short retry absorbs almost all of those errors.
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 1200));
    return await fn();
  }
}

// --- Overview / dashboard ---
export async function getOverview() {
  await verifySession();
  const [projects, tasks, goals] = await retryOnce(() => Promise.all([
    prisma.jarvisProject.findMany({
      where: { status: { in: ["active", "stalled"] } },
      orderBy: { lastActivityAt: "asc" },
      include: {
        venture: true,
        _count: { select: { tasks: true } },
        tasks: { select: { status: true, dueDate: true } },
      },
    }),
    prisma.jarvisTask.findMany({
      where: { status: { not: "done" }, dueDate: { not: null } },
      orderBy: { dueDate: "asc" },
      take: 25,
      include: { project: true },
    }),
    prisma.jarvisGoal.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "asc" },
      include: { milestones: true },
    }),
  ]));
  return { projects, tasks, goals };
}

// --- Ventures ---
export async function listVentures() {
  await verifySession();
  return prisma.jarvisVenture.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { projects: true } } },
  });
}

export async function getVenture(id: string) {
  await verifySession();
  return prisma.jarvisVenture.findUnique({
    where: { id },
    include: { projects: { orderBy: { lastActivityAt: "desc" } } },
  });
}

// --- Projects ---
export async function listProjects() {
  await verifySession();
  return prisma.jarvisProject.findMany({
    orderBy: { lastActivityAt: "desc" },
    include: { venture: true, _count: { select: { tasks: true } } },
  });
}

export async function getProject(id: string) {
  await verifySession();
  return prisma.jarvisProject.findUnique({
    where: { id },
    include: {
      venture: true,
      tasks: { orderBy: [{ status: "asc" }, { dueDate: "asc" }] },
      notes: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { createdAt: "desc" } },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
}

// --- Inbox (quick captures) ---
export async function listInboxNotes() {
  await verifySession();
  return prisma.jarvisNote.findMany({
    where: { source: "capture", projectId: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

// --- Latest morning briefing (for the overview card) ---
export async function latestBriefing() {
  await verifySession();
  return prisma.jarvisNote.findFirst({
    where: {
      body: { startsWith: "Morning briefing:" },
      createdAt: { gt: new Date(Date.now() - 36 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
}

// --- Documents ---
export async function listUnfiledDocuments() {
  await verifySession();
  return prisma.jarvisDocument.findMany({
    where: { projectId: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, summary: true, createdAt: true },
  });
}

// --- Goals ---
export async function listGoals() {
  await verifySession();
  return prisma.jarvisGoal.findMany({
    orderBy: { createdAt: "asc" },
    include: { milestones: { orderBy: { createdAt: "asc" } } },
  });
}

// --- Chat threads ---
export async function listThreads() {
  await verifySession();
  return retryOnce(() => prisma.jarvisThread.findMany({ orderBy: { updatedAt: "desc" } }));
}

export async function getThread(id: string) {
  await verifySession();
  return prisma.jarvisThread.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      proposals: { orderBy: { createdAt: "asc" } },
    },
  });
}

// For dropdowns when creating tasks/notes.
export async function projectOptions() {
  await verifySession();
  return prisma.jarvisProject.findMany({
    where: { status: { not: "done" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
