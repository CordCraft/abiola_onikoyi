"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { generateAccessCode } from "@/lib/mentorship/codes";
import {
  GOAL_STATUSES,
  RESOURCE_CATEGORIES,
  SESSION_STATUSES,
} from "@/lib/mentorship/constants";

export type AdminFormResult = { error?: string; ok?: boolean } | undefined;

// Every admin action verifies the admin session first. Table setup is ensured
// on the cheap actions that can run first in a fresh database.

function revalidateMentee(menteeId: string) {
  revalidatePath("/dashboard/mentorship");
  revalidatePath(`/dashboard/mentorship/${menteeId}`);
  revalidatePath("/mentorship/portal");
  revalidatePath("/mentorship/portal/goals");
  revalidatePath("/mentorship/portal/checkins");
  revalidatePath("/mentorship/portal/messages");
}

function revalidateCohort() {
  revalidatePath("/dashboard/mentorship");
  revalidatePath("/dashboard/mentorship/programme");
  revalidatePath("/mentorship/portal");
  revalidatePath("/mentorship/portal/sessions");
  revalidatePath("/mentorship/portal/resources");
}

// Interpreted as West Africa Time (the cohort is in Lagos, no DST).
function parseWatDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 16)}:00+01:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createMentee(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();
  await ensureMentorshipTables();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const headline = String(formData.get("headline") ?? "").trim() || null;
  const focusArea = String(formData.get("focusArea") ?? "").trim() || null;

  if (!name || !email) return { error: "Name and email are required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email does not look valid." };
  }

  const existing = await prisma.mentorshipMentee.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return { error: "A mentee with that email already exists." };

  const mentee = await prisma.mentorshipMentee.create({
    data: { name, email, headline, focusArea, accessCode: generateAccessCode() },
  });

  revalidatePath("/dashboard/mentorship");
  redirect(`/dashboard/mentorship/${mentee.id}`);
}

export async function updateMentee(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const headline = String(formData.get("headline") ?? "").trim() || null;
  const focusArea = String(formData.get("focusArea") ?? "").trim() || null;

  if (!id) return { error: "Missing mentee id." };
  if (!name || !email) return { error: "Name and email are required." };

  const clash = await prisma.mentorshipMentee.findUnique({
    where: { email },
    select: { id: true },
  });
  if (clash && clash.id !== id) {
    return { error: "Another mentee already uses that email." };
  }

  await prisma.mentorshipMentee.update({
    where: { id },
    data: { name, email, headline, focusArea },
  });

  revalidateMentee(id);
  return { ok: true };
}

export async function setMenteeActive(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  await prisma.mentorshipMentee.update({ where: { id }, data: { active } });
  revalidateMentee(id);
}

export async function regenerateAccessCode(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.mentorshipMentee.update({
    where: { id },
    data: { accessCode: generateAccessCode() },
  });
  revalidateMentee(id);
}

export async function adminAddGoal(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();

  const menteeId = String(formData.get("menteeId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim() || null;
  const monthRaw = Number(formData.get("targetMonth"));
  const targetMonth = monthRaw >= 1 && monthRaw <= 3 ? monthRaw : null;

  if (!menteeId) return { error: "Missing mentee id." };
  if (!title) return { error: "Give the goal a title." };

  await prisma.mentorshipGoal.create({
    data: { menteeId, title, detail, targetMonth },
  });

  revalidateMentee(menteeId);
  return { ok: true };
}

export async function adminSetGoalStatus(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(GOAL_STATUSES as readonly string[]).includes(status)) return;

  const goal = await prisma.mentorshipGoal.update({
    where: { id },
    data: {
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
  });
  revalidateMentee(goal.menteeId);
}

export async function adminAddTask(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();

  const menteeId = String(formData.get("menteeId") ?? "");
  const goalId = String(formData.get("goalId") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const dueRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = dueRaw ? new Date(`${dueRaw}T23:59:00+01:00`) : null;

  if (!menteeId) return { error: "Missing mentee id." };
  if (!title) return { error: "Give the task a title." };
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return { error: "That due date is not valid." };
  }

  await prisma.mentorshipTask.create({
    data: { menteeId, goalId, title, notes, dueDate, createdBy: "mentor" },
  });

  revalidateMentee(menteeId);
  return { ok: true };
}

export async function adminToggleTask(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const task = await prisma.mentorshipTask.findUnique({ where: { id } });
  if (!task) return;

  const done = task.status !== "done";
  await prisma.mentorshipTask.update({
    where: { id },
    data: { status: done ? "done" : "todo", completedAt: done ? new Date() : null },
  });
  revalidateMentee(task.menteeId);
}

export async function adminDeleteTask(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const task = await prisma.mentorshipTask.delete({ where: { id } }).catch(() => null);
  if (task) revalidateMentee(task.menteeId);
}

export async function replyToCheckin(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();

  const id = String(formData.get("id") ?? "");
  const reply = String(formData.get("reply") ?? "").trim();
  if (!id) return { error: "Missing check-in id." };
  if (!reply) return { error: "Write a reply first." };

  const checkin = await prisma.mentorshipCheckin.update({
    where: { id },
    data: { mentorReply: reply, repliedAt: new Date() },
  });

  revalidateMentee(checkin.menteeId);
  return { ok: true };
}

export async function adminSendMessage(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();

  const menteeId = String(formData.get("menteeId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!menteeId) return { error: "Missing mentee id." };
  if (!body) return { error: "Write a message first." };
  if (body.length > 5000) return { error: "Keep messages under 5000 characters." };

  await prisma.mentorshipMessage.create({
    data: { menteeId, sender: "mentor", body },
  });

  revalidateMentee(menteeId);
  return { ok: true };
}

export async function createMentorshipSession(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();
  await ensureMentorshipTables();

  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "group");
  const menteeId = String(formData.get("menteeId") ?? "").trim() || null;
  const scheduledAt = parseWatDateTime(String(formData.get("scheduledAt") ?? ""));
  const link = String(formData.get("link") ?? "").trim() || null;
  const agenda = String(formData.get("agenda") ?? "").trim() || null;

  if (!title) return { error: "Give the session a title." };
  if (!scheduledAt) return { error: "Pick a valid date and time." };
  if (kind === "one_on_one" && !menteeId) {
    return { error: "Pick the mentee for a one-on-one session." };
  }

  await prisma.mentorshipSession.create({
    data: {
      title,
      kind: kind === "one_on_one" ? "one_on_one" : "group",
      menteeId: kind === "one_on_one" ? menteeId : null,
      scheduledAt,
      link,
      agenda,
    },
  });

  revalidateCohort();
  return { ok: true };
}

export async function updateMentorshipSession(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!id) return;

  await prisma.mentorshipSession.update({
    where: { id },
    data: {
      ...((SESSION_STATUSES as readonly string[]).includes(status)
        ? { status }
        : {}),
      ...(notes ? { notes } : {}),
    },
  });
  revalidateCohort();
}

export async function deleteMentorshipSession(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.mentorshipSession.delete({ where: { id } }).catch(() => null);
  revalidateCohort();
}

export async function createResource(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();
  await ensureMentorshipTables();

  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const categoryRaw = String(formData.get("category") ?? "reading");
  const category = (RESOURCE_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? categoryRaw
    : "reading";
  const pinned = formData.get("pinned") === "on";

  if (!title) return { error: "Give the resource a title." };
  if (url && !/^https?:\/\//.test(url)) {
    return { error: "Links must start with http:// or https://." };
  }

  await prisma.mentorshipResource.create({
    data: { title, url, note, category, pinned },
  });

  revalidateCohort();
  return { ok: true };
}

export async function deleteResource(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.mentorshipResource.delete({ where: { id } }).catch(() => null);
  revalidateCohort();
}

export async function createAnnouncement(
  _prev: AdminFormResult,
  formData: FormData,
): Promise<AdminFormResult> {
  await verifySession();
  await ensureMentorshipTables();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "Announcements need a title and a body." };

  await prisma.mentorshipAnnouncement.create({ data: { title, body } });

  revalidateCohort();
  return { ok: true };
}

export async function deleteAnnouncement(formData: FormData): Promise<void> {
  await verifySession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.mentorshipAnnouncement.delete({ where: { id } }).catch(() => null);
  revalidateCohort();
}
