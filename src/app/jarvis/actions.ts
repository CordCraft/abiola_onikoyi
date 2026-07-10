"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { deleteSession } from "@/lib/session";

export type FormResult = { error?: string; ok?: boolean } | undefined;

function revalidateJarvis() {
  revalidatePath("/jarvis");
  revalidatePath("/jarvis/ventures");
  revalidatePath("/jarvis/projects");
  revalidatePath("/jarvis/goals");
  revalidatePath("/jarvis/chat");
}

function s(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function opt(v: FormDataEntryValue | null): string | null {
  const x = s(v);
  return x || null;
}
function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
async function bump(projectId: string | null | undefined) {
  if (projectId) {
    await prisma.jarvisProject
      .update({ where: { id: projectId }, data: { lastActivityAt: new Date() } })
      .catch(() => {});
  }
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

// --- Proposals (from chat) ---
export async function applyProposal(id: string): Promise<FormResult> {
  await verifySession();
  const p = await prisma.jarvisProposal.findUnique({ where: { id } });
  if (!p || p.status !== "pending") return { error: "Proposal not available." };
  const d = (p.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (d[k] == null ? null : String(d[k]).trim() || null);

  try {
    switch (p.kind) {
      case "create_project": {
        let ventureId: string | null = null;
        const vname = str("ventureName");
        if (vname) {
          const v = await prisma.jarvisVenture.findFirst({
            where: { name: { contains: vname, mode: "insensitive" } },
            select: { id: true },
          });
          ventureId = v?.id ?? null;
        }
        await prisma.jarvisProject.create({
          data: {
            name: str("name") ?? "Untitled",
            status: str("status") ?? "active",
            priority: str("priority") ?? "medium",
            summary: str("summary"),
            ventureId,
          },
        });
        break;
      }
      case "update_project": {
        const pid = str("projectId");
        if (!pid) return { error: "Missing project." };
        await prisma.jarvisProject.update({
          where: { id: pid },
          data: {
            ...(str("status") ? { status: str("status")! } : {}),
            ...(str("priority") ? { priority: str("priority")! } : {}),
            ...(str("summary") ? { summary: str("summary") } : {}),
            lastActivityAt: new Date(),
          },
        });
        break;
      }
      case "create_task": {
        const pid = str("projectId");
        await prisma.jarvisTask.create({
          data: {
            title: str("title") ?? "Untitled task",
            projectId: pid,
            priority: str("priority") ?? "medium",
            dueDate: parseDate(d.dueDate),
          },
        });
        await bump(pid);
        break;
      }
      case "log_note": {
        const pid = str("projectId");
        await prisma.jarvisNote.create({
          data: { body: str("body") ?? "", projectId: pid },
        });
        await bump(pid);
        break;
      }
      case "log_decision": {
        const pid = str("projectId");
        await prisma.jarvisDecision.create({
          data: {
            title: str("title") ?? "Decision",
            rationale: str("rationale") ?? "",
            projectId: pid,
          },
        });
        await bump(pid);
        break;
      }
      case "set_goal": {
        await prisma.jarvisGoal.create({
          data: {
            title: str("title") ?? "Goal",
            description: str("description"),
            horizon: str("horizon"),
            targetDate: parseDate(d.targetDate),
          },
        });
        break;
      }
      default:
        return { error: `Unknown proposal type: ${p.kind}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to apply." };
  }

  await prisma.jarvisProposal.update({
    where: { id },
    data: { status: "applied", appliedAt: new Date() },
  });
  revalidateJarvis();
  return { ok: true };
}

export async function discardProposal(id: string): Promise<FormResult> {
  await verifySession();
  await prisma.jarvisProposal.update({
    where: { id },
    data: { status: "discarded" },
  });
  return { ok: true };
}

// --- Ventures ---
export async function createVenture(_p: FormResult, f: FormData): Promise<FormResult> {
  await verifySession();
  const name = s(f.get("name"));
  if (!name) return { error: "Name is required." };
  await prisma.jarvisVenture.create({
    data: { name, description: opt(f.get("description")), status: s(f.get("status")) || "active" },
  });
  revalidateJarvis();
  redirect("/jarvis/ventures");
}
export async function deleteVenture(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  if (id) await prisma.jarvisVenture.delete({ where: { id } });
  revalidateJarvis();
  redirect("/jarvis/ventures");
}

// --- Projects ---
export async function createProject(_p: FormResult, f: FormData): Promise<FormResult> {
  await verifySession();
  const name = s(f.get("name"));
  if (!name) return { error: "Name is required." };
  const project = await prisma.jarvisProject.create({
    data: {
      name,
      ventureId: opt(f.get("ventureId")),
      status: s(f.get("status")) || "active",
      priority: s(f.get("priority")) || "medium",
      summary: opt(f.get("summary")),
    },
  });
  revalidateJarvis();
  redirect(`/jarvis/projects/${project.id}`);
}
export async function updateProject(_p: FormResult, f: FormData): Promise<FormResult> {
  await verifySession();
  const id = s(f.get("id"));
  if (!id) return { error: "Missing id." };
  await prisma.jarvisProject.update({
    where: { id },
    data: {
      name: s(f.get("name")) || undefined,
      ventureId: opt(f.get("ventureId")),
      status: s(f.get("status")) || undefined,
      priority: s(f.get("priority")) || undefined,
      summary: opt(f.get("summary")),
      lastActivityAt: new Date(),
    },
  });
  revalidateJarvis();
  revalidatePath(`/jarvis/projects/${id}`);
  return { ok: true };
}
export async function deleteProject(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  if (id) await prisma.jarvisProject.delete({ where: { id } });
  revalidateJarvis();
  redirect("/jarvis");
}

// --- Tasks ---
export async function createTask(f: FormData) {
  await verifySession();
  const title = s(f.get("title"));
  const projectId = opt(f.get("projectId"));
  if (title) {
    await prisma.jarvisTask.create({
      data: {
        title,
        projectId,
        priority: s(f.get("priority")) || "medium",
        dueDate: parseDate(f.get("dueDate")),
      },
    });
    await bump(projectId);
  }
  revalidateJarvis();
  if (projectId) revalidatePath(`/jarvis/projects/${projectId}`);
}
export async function cycleTask(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  const t = await prisma.jarvisTask.findUnique({ where: { id } });
  if (t) {
    const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
    await prisma.jarvisTask.update({
      where: { id },
      data: { status: next, completedAt: next === "done" ? new Date() : null },
    });
    await bump(t.projectId);
    if (t.projectId) revalidatePath(`/jarvis/projects/${t.projectId}`);
  }
  revalidateJarvis();
}
export async function deleteTask(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  const t = await prisma.jarvisTask.findUnique({ where: { id } });
  if (t) {
    await prisma.jarvisTask.delete({ where: { id } });
    if (t.projectId) revalidatePath(`/jarvis/projects/${t.projectId}`);
  }
  revalidateJarvis();
}

// --- Notes & decisions ---
export async function createNote(f: FormData) {
  await verifySession();
  const body = s(f.get("body"));
  const projectId = opt(f.get("projectId"));
  if (body) {
    await prisma.jarvisNote.create({ data: { body, projectId } });
    await bump(projectId);
    if (projectId) revalidatePath(`/jarvis/projects/${projectId}`);
  }
  revalidateJarvis();
}
export async function createDecision(f: FormData) {
  await verifySession();
  const title = s(f.get("title"));
  const rationale = s(f.get("rationale"));
  const projectId = opt(f.get("projectId"));
  if (title && rationale) {
    await prisma.jarvisDecision.create({ data: { title, rationale, projectId } });
    await bump(projectId);
    if (projectId) revalidatePath(`/jarvis/projects/${projectId}`);
  }
  revalidateJarvis();
}

// --- Goals & milestones ---
export async function createGoal(_p: FormResult, f: FormData): Promise<FormResult> {
  await verifySession();
  const title = s(f.get("title"));
  if (!title) return { error: "Title is required." };
  await prisma.jarvisGoal.create({
    data: {
      title,
      description: opt(f.get("description")),
      horizon: opt(f.get("horizon")),
      targetDate: parseDate(f.get("targetDate")),
    },
  });
  revalidateJarvis();
  redirect("/jarvis/goals");
}
export async function deleteGoal(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  if (id) await prisma.jarvisGoal.delete({ where: { id } });
  revalidateJarvis();
  redirect("/jarvis/goals");
}
export async function addMilestone(f: FormData) {
  await verifySession();
  const goalId = s(f.get("goalId"));
  const title = s(f.get("title"));
  if (goalId && title) {
    await prisma.jarvisMilestone.create({
      data: { goalId, title, dueDate: parseDate(f.get("dueDate")) },
    });
  }
  revalidateJarvis();
}
export async function toggleMilestone(f: FormData) {
  await verifySession();
  const id = s(f.get("id"));
  const m = await prisma.jarvisMilestone.findUnique({ where: { id } });
  if (m) await prisma.jarvisMilestone.update({ where: { id }, data: { done: !m.done } });
  revalidateJarvis();
}
