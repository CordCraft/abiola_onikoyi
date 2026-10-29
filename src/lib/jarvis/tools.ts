import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { getUpcomingEvents, formatEvents } from "@/lib/jarvis/calendar";
import { indexRecord, semanticSearch } from "@/lib/jarvis/embeddings";
import { ensureSyncTables } from "@/lib/jarvis/sync/setup";
import { getAlerts } from "@/lib/jarvis/sync/digest";
import { gh } from "@/lib/jarvis/sync/github";

// Jarvis tool surface. Read tools run live queries. Write tools apply
// IMMEDIATELY (no confirmation step) and report a receipt the UI shows with an
// Undo affordance. Every write is attributed to the right project when one can
// be resolved.

export type SavedRecord = {
  kind:
    | "project"
    | "project_update"
    | "task"
    | "task_done"
    | "note"
    | "decision"
    | "goal"
    | "document"
    | "github_issue";
  id: string;
  summary: string;
  undoable: boolean;
};

export type ToolContext = {
  onSaved?: (record: SavedRecord) => void;
};

export const jarvisTools = [
  // ── Read tools ─────────────────────────────────────────────────────────────
  {
    name: "list_projects",
    description:
      "List projects, optionally filtered by status (idea|active|stalled|paused|done).",
    input_schema: {
      type: "object" as const,
      properties: { status: { type: "string", description: "Optional status filter" } },
    },
  },
  {
    name: "get_project",
    description:
      "Get one project's full details: tasks, recent notes, decisions, and attached documents. Provide id or name.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        name: { type: "string", description: "Project name (partial match ok)" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "List open tasks, optionally filtered by status or project name.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string" },
        projectName: { type: "string" },
      },
    },
  },
  {
    name: "search_notes",
    description: "Keyword search across notes.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "search_documents",
    description:
      "Keyword search across stored documents (uploaded files). Searches names and full text. Returns matches with ids for read_document.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "read_document",
    description: "Read a stored document's full extracted text by id.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_calendar",
    description:
      "Read the user's upcoming calendar events (from their connected calendar feed). Use for questions about meetings, schedule, or availability.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "How many days ahead to look (default 7, max 31)" },
      },
    },
  },

  // ── Write tools (apply immediately) ───────────────────────────────────────
  {
    name: "create_project",
    description:
      "Create a new project. Applies immediately. Call when the user asks to start/track a new project.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        ventureName: { type: "string" },
        status: { type: "string", description: "idea|active|stalled|paused|done" },
        priority: { type: "string", description: "low|medium|high" },
        summary: { type: "string", description: "One-paragraph description of the project" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description:
      "Update a project's status, priority, or summary. Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string" },
        projectName: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create a task, optionally under a project, with an optional due date (YYYY-MM-DD). Applies immediately. If a very similar open task exists, nothing is created and you are told; pass allowDuplicate true only when it is genuinely a different task.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        projectName: { type: "string" },
        projectId: { type: "string" },
        priority: { type: "string" },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        recurrence: { type: "string", description: "daily|weekly|monthly - completing the task spawns the next occurrence" },
        allowDuplicate: { type: "boolean" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_tasks_bulk",
    description:
      "Create several tasks at once under one project (e.g. instantiating a playbook or a meeting's action items). Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string" },
        projectName: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              dueInDays: { type: "number", description: "Days from today" },
              dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
              priority: { type: "string" },
              recurrence: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "add_milestone",
    description: "Add a milestone to a goal. Provide goalId ([goal:<id>] in the snapshot) or goalTitle.",
    input_schema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string" },
        goalTitle: { type: "string" },
        title: { type: "string" },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_milestone",
    description: "Mark a goal milestone done. Provide milestoneId ([ms:<id>] in the snapshot) or its title.",
    input_schema: {
      type: "object" as const,
      properties: {
        milestoneId: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done. Provide taskId or an exact-enough title.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "log_note",
    description:
      "Save a note, optionally under a project. Applies immediately. Use for any information worth remembering.",
    input_schema: {
      type: "object" as const,
      properties: {
        body: { type: "string" },
        projectName: { type: "string" },
        projectId: { type: "string" },
      },
      required: ["body"],
    },
  },
  {
    name: "log_decision",
    description:
      "Save a decision and its rationale, optionally under a project. Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        rationale: { type: "string" },
        projectName: { type: "string" },
        projectId: { type: "string" },
      },
      required: ["title", "rationale"],
    },
  },
  {
    name: "set_goal",
    description: "Create a long-term goal. Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        horizon: { type: "string" },
        targetDate: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "file_document",
    description:
      "Attach an already-stored document to a project and record a 1-3 sentence summary of its contents. Call this once for EVERY document id listed in the message when files are attached.",
    input_schema: {
      type: "object" as const,
      properties: {
        documentId: { type: "string" },
        projectId: { type: "string" },
        projectName: { type: "string" },
        summary: { type: "string", description: "1-3 sentence summary of the document" },
      },
      required: ["documentId", "summary"],
    },
  },
  {
    name: "save_document",
    description:
      "Create a new document in the library from content you produce: an image transcription, a meeting summary, research output, or any text worth keeping verbatim. Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Short filename-like title, e.g. 'Whiteboard - funding options.txt'" },
        content: { type: "string", description: "The full text content to store" },
        projectId: { type: "string" },
        projectName: { type: "string" },
        summary: { type: "string", description: "1-2 sentence summary" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "file_note",
    description:
      "Attach an inbox note (quick capture) to a project, converting it into a normal project note. Use the [note:<id>] ids shown in the Inbox section of the snapshot.",
    input_schema: {
      type: "object" as const,
      properties: {
        noteId: { type: "string" },
        projectId: { type: "string" },
        projectName: { type: "string" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "link_source",
    description:
      "Attach a GitHub repo, Netlify site, Supabase database or Claude Code folder to a Jarvis project (fixes wrong or duplicate auto-tracked projects). Moves its activity to that project, and deletes the old auto-created project if it is now empty. Use subject exactly as shown in activity, e.g. CordCraft/hoppertax.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "github | netlify | supabase | claude" },
        subject: { type: "string" },
        projectId: { type: "string" },
        projectName: { type: "string" },
      },
      required: ["source", "subject"],
    },
  },
  {
    name: "ask_claude_code",
    description:
      "Hand a coding job to Claude Code by opening a GitHub issue that mentions @claude in the project's repo. Claude Code (GitHub app) picks it up, works on a branch and opens a pull request. Use when the user asks Jarvis to build, fix or change something in one of their codebases. Write a self-contained brief: goal, relevant files or pages, and what done looks like.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: { type: "string", description: "owner/name, e.g. CordCraft/hoppertax. Optional if projectName given." },
        projectName: { type: "string", description: "Jarvis project whose linked GitHub repo to use" },
        title: { type: "string" },
        brief: { type: "string", description: "Full instructions for Claude Code" },
      },
      required: ["title", "brief"],
    },
  },
];

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function parseDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type Input = Record<string, unknown>;

async function resolveProject(input: Input): Promise<{ id: string; name: string } | null> {
  const id = str(input.projectId) ?? str(input.id);
  if (id) {
    const p = await prisma.jarvisProject.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (p) return p;
  }
  const name = str(input.projectName) ?? str(input.name);
  if (name) {
    const p = await prisma.jarvisProject.findFirst({
      where: { name: { contains: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (p) return p;
  }
  return null;
}

async function bump(projectId: string | null | undefined) {
  if (projectId) {
    await prisma.jarvisProject
      .update({ where: { id: projectId }, data: { lastActivityAt: new Date() } })
      .catch(() => {});
  }
}

const RECURRENCES = new Set(["daily", "weekly", "monthly"]);

export function nextOccurrence(from: Date, recurrence: string): Date {
  const d = new Date(from);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

// Spawn the next occurrence of a recurring task; shared with server actions.
export async function respawnRecurringTask(task: {
  title: string;
  projectId: string | null;
  priority: string;
  dueDate: Date | null;
  recurrence: string | null;
}): Promise<Date | null> {
  if (!task.recurrence || !RECURRENCES.has(task.recurrence)) return null;
  const base = task.dueDate ?? new Date();
  const nextDue = nextOccurrence(base, task.recurrence);
  await prisma.jarvisTask.create({
    data: {
      title: task.title,
      projectId: task.projectId,
      priority: task.priority,
      dueDate: nextDue,
      recurrence: task.recurrence,
    },
  });
  return nextDue;
}

// Near-duplicate open task by trigram similarity; ILIKE fallback.
async function findDuplicateTask(
  title: string,
): Promise<{ id: string; title: string; projectName: string | null } | null> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; title: string; projectName: string | null }[]>`
      SELECT t.id, t.title, p.name AS "projectName"
      FROM "JarvisTask" t LEFT JOIN "JarvisProject" p ON p.id = t."projectId"
      WHERE t.status <> 'done' AND similarity(t.title, ${title}) > 0.55
      ORDER BY similarity(t.title, ${title}) DESC LIMIT 1`;
    if (rows[0]) return rows[0];
  } catch {
    const t = await prisma.jarvisTask.findFirst({
      where: { title: { equals: title, mode: "insensitive" }, status: { not: "done" } },
      include: { project: { select: { name: true } } },
    });
    if (t) return { id: t.id, title: t.title, projectName: t.project?.name ?? null };
  }
  return null;
}

const MAX_DOC_READ = 60_000; // chars returned to the model per read_document

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext = {},
): Promise<string> {
  const input = (rawInput ?? {}) as Input;
  const saved = (record: SavedRecord) => ctx.onSaved?.(record);

  switch (name) {
    // ── Reads ────────────────────────────────────────────────────────────────
    case "list_projects": {
      const status = str(input.status);
      const ps = await prisma.jarvisProject.findMany({
        where: status ? { status } : {},
        orderBy: { lastActivityAt: "desc" },
        take: 50,
        include: { venture: { select: { name: true } } },
      });
      if (!ps.length) return "(no projects)";
      return ps
        .map(
          (p) =>
            `- ${p.name} [${p.status}, ${p.priority}]${p.venture ? ` (venture ${p.venture.name})` : ""} id:${p.id}`,
        )
        .join("\n");
    }
    case "get_project": {
      const ref = await resolveProject(input);
      if (!ref) return "No matching project found.";
      const p = await prisma.jarvisProject.findUnique({
        where: { id: ref.id },
        include: {
          venture: { select: { name: true } },
          tasks: { orderBy: { dueDate: "asc" } },
          notes: { orderBy: { createdAt: "desc" }, take: 10 },
          decisions: { orderBy: { createdAt: "desc" }, take: 10 },
          documents: {
            orderBy: { createdAt: "desc" },
            take: 15,
            select: { id: true, name: true, summary: true },
          },
        },
      });
      if (!p) return "Not found.";
      const parts = [
        `${p.name} [${p.status}, ${p.priority}]${p.venture ? ` venture:${p.venture.name}` : ""} id:${p.id}`,
        p.summary ? `Summary: ${p.summary}` : "",
        `Tasks:\n${p.tasks.map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${formatDate(t.dueDate)})` : ""} id:${t.id}`).join("\n") || "  (none)"}`,
        `Notes:\n${p.notes.map((n) => `  - ${n.body.slice(0, 160)}`).join("\n") || "  (none)"}`,
        `Decisions:\n${p.decisions.map((d) => `  - ${d.title}: ${d.rationale.slice(0, 160)}`).join("\n") || "  (none)"}`,
        `Documents:\n${p.documents.map((d) => `  - ${d.name}${d.summary ? `: ${d.summary}` : ""} [doc:${d.id}]`).join("\n") || "  (none)"}`,
      ];
      return parts.filter(Boolean).join("\n");
    }
    case "list_tasks": {
      const where: Record<string, unknown> = {};
      const status = str(input.status);
      if (status) where.status = status;
      else where.status = { not: "done" };
      const pname = str(input.projectName);
      if (pname) {
        const ref = await resolveProject({ projectName: pname });
        if (ref) where.projectId = ref.id;
      }
      const ts = await prisma.jarvisTask.findMany({
        where,
        orderBy: { dueDate: "asc" },
        take: 60,
        include: { project: { select: { name: true } } },
      });
      if (!ts.length) return "(no tasks)";
      return ts
        .map(
          (t) =>
            `- [${t.status}, ${t.priority}] ${t.title}${t.dueDate ? ` due ${formatDate(t.dueDate)}` : ""}${t.project ? ` (${t.project.name})` : ""} id:${t.id}`,
        )
        .join("\n");
    }
    case "search_notes": {
      const q = str(input.query) ?? "";
      if (!q) return "A query is required.";
      // Full-text search first (matches word forms: "financing" finds
      // "financed"), then substring fallback so short/partial terms still hit.
      type NoteRow = { id: string; body: string; projectName: string | null };
      let rows: NoteRow[] = [];
      try {
        rows = await prisma.$queryRaw<NoteRow[]>`
          SELECT n.id, n.body, p.name AS "projectName"
          FROM "JarvisNote" n LEFT JOIN "JarvisProject" p ON p.id = n."projectId"
          WHERE to_tsvector('english', n.body) @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank(to_tsvector('english', n.body), websearch_to_tsquery('english', ${q})) DESC
          LIMIT 12`;
      } catch {
        rows = [];
      }
      if (!rows.length) {
        const ns = await prisma.jarvisNote.findMany({
          where: { body: { contains: q, mode: "insensitive" } },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: { project: { select: { name: true } } },
        });
        rows = ns.map((n) => ({ id: n.id, body: n.body, projectName: n.project?.name ?? null }));
      }
      // Semantic layer: meaning-based matches the keyword pass missed.
      const semantic = await semanticSearch(q, ["note"], 6);
      const seen = new Set(rows.map((r) => r.id));
      for (const hit of semantic) {
        if (seen.has(hit.recordId)) continue;
        const n = await prisma.jarvisNote.findUnique({
          where: { id: hit.recordId },
          include: { project: { select: { name: true } } },
        });
        if (n) rows.push({ id: n.id, body: n.body, projectName: n.project?.name ?? null });
      }
      if (!rows.length) return "(no matching notes)";
      return rows
        .slice(0, 12)
        .map((n) => `- ${n.projectName ? `(${n.projectName}) ` : ""}${n.body.slice(0, 220)}`)
        .join("\n");
    }
    case "search_documents": {
      const q = str(input.query) ?? "";
      if (!q) return "A query is required.";
      type DocRow = { id: string; name: string; projectName: string | null; snippet: string };
      let rows: DocRow[] = [];
      try {
        rows = await prisma.$queryRaw<DocRow[]>`
          SELECT d.id, d.name, p.name AS "projectName",
            ts_headline('english', left(d.content, 20000), websearch_to_tsquery('english', ${q}),
              'MaxWords=35, MinWords=15, StartSel=, StopSel=') AS snippet
          FROM "JarvisDocument" d LEFT JOIN "JarvisProject" p ON p.id = d."projectId"
          WHERE to_tsvector('english', d.name || ' ' || coalesce(d.summary, '') || ' ' || d.content)
            @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank(to_tsvector('english', d.name || ' ' || coalesce(d.summary, '') || ' ' || d.content),
            websearch_to_tsquery('english', ${q})) DESC
          LIMIT 10`;
      } catch {
        rows = [];
      }
      if (!rows.length) {
        const docs = await prisma.jarvisDocument.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
              { summary: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { project: { select: { name: true } } },
        });
        rows = docs.map((d) => {
          const idx = d.content.toLowerCase().indexOf(q.toLowerCase());
          const snippet =
            idx >= 0
              ? d.content.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, " ")
              : d.content.slice(0, 160).replace(/\s+/g, " ");
          return { id: d.id, name: d.name, projectName: d.project?.name ?? null, snippet };
        });
      }
      // Semantic layer: meaning-based matches ("financing" finds "capex").
      const semantic = await semanticSearch(q, ["document"], 6);
      const seen = new Set(rows.map((r) => r.id));
      for (const hit of semantic) {
        if (seen.has(hit.recordId)) continue;
        const d = await prisma.jarvisDocument.findUnique({
          where: { id: hit.recordId },
          include: { project: { select: { name: true } } },
        });
        if (d) {
          rows.push({
            id: d.id,
            name: d.name,
            projectName: d.project?.name ?? null,
            snippet: hit.content.slice(0, 220),
          });
        }
      }
      if (!rows.length) return "(no matching documents)";
      return rows
        .slice(0, 10)
        .map(
          (d) =>
            `- ${d.name}${d.projectName ? ` (${d.projectName})` : ""} [doc:${d.id}]\n  ...${d.snippet.replace(/\s+/g, " ")}...`,
        )
        .join("\n");
    }
    case "get_activity": {
      await ensureSyncTables();
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 90);
      const source = str(input.source);
      const q = str(input.query);
      const proj = str(input.projectName) ? await resolveProject({ projectName: input.projectName }) : null;
      const rows = await prisma.jarvisActivity.findMany({
        where: {
          occurredAt: { gt: new Date(Date.now() - days * 864e5) },
          ...(source ? { source } : {}),
          ...(proj ? { projectId: proj.id } : {}),
          ...(q
            ? {
                OR: [
                  { subject: { contains: q, mode: "insensitive" } },
                  { title: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: 60,
      });
      const alerts = await getAlerts();
      const head = alerts.length ? `Alerts:\n${alerts.map((a) => `- ${a.text}`).join("\n")}\n\n` : "";
      if (!rows.length) return `${head}No activity in the last ${days} days for that filter.`;
      return (
        head +
        rows
          .map((r) => {
            const detail = r.detail ? `\n  ${r.detail.replace(/\s+/g, " ").slice(0, r.kind === "session" ? 900 : 200)}` : "";
            return `- ${formatDate(r.occurredAt)} [${r.source} ${r.kind}${r.state ? `, ${r.state}` : ""}] ${r.subject}: ${r.title}${r.url ? ` (${r.url})` : ""}${detail}`;
          })
          .join("\n")
      );
    }
    case "get_calendar": {
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 31);
      const events = await getUpcomingEvents(days);
      if (events === null)
        return "No calendar is connected. The user can paste their calendar's secret ICS address on the Memory page (/jarvis/memory).";
      return `Upcoming events (next ${days} days):\n${formatEvents(events)}`;
    }
    case "read_document": {
      const id = str(input.id);
      if (!id) return "A document id is required.";
      const d = await prisma.jarvisDocument.findUnique({
        where: { id },
        include: { project: { select: { name: true } } },
      });
      if (!d) return "Document not found.";
      const body =
        d.content.length > MAX_DOC_READ
          ? d.content.slice(0, MAX_DOC_READ) + "\n\n[... truncated ...]"
          : d.content;
      return `Document: ${d.name}${d.project ? ` (project ${d.project.name})` : ""}\n\n${body}`;
    }

    // ── Writes (apply immediately) ───────────────────────────────────────────
    case "create_project": {
      const name = str(input.name);
      if (!name) return "A project name is required.";
      const existing = await prisma.jarvisProject.findFirst({
        where: { name: { contains: name, mode: "insensitive" }, status: { not: "done" } },
        select: { id: true, name: true },
      });
      if (existing) {
        return `DUPLICATE GUARD: project "${existing.name}" (id:${existing.id}) already exists. Nothing was created. Use update_project or attach records to it instead.`;
      }
      let ventureId: string | null = null;
      const vname = str(input.ventureName);
      if (vname) {
        const v = await prisma.jarvisVenture.findFirst({
          where: { name: { contains: vname, mode: "insensitive" } },
          select: { id: true },
        });
        ventureId = v?.id ?? null;
      }
      const p = await prisma.jarvisProject.create({
        data: {
          name,
          status: str(input.status) ?? "active",
          priority: str(input.priority) ?? "medium",
          summary: str(input.summary) ?? null,
          ventureId,
        },
      });
      saved({ kind: "project", id: p.id, summary: `Created project "${name}"`, undoable: true });
      return `SAVED project "${name}" id:${p.id}. It is live in the workspace now.`;
    }
    case "update_project": {
      const ref = await resolveProject(input);
      if (!ref) return "No matching project to update.";
      const status = str(input.status);
      const priority = str(input.priority);
      const summary = str(input.summary);
      await prisma.jarvisProject.update({
        where: { id: ref.id },
        data: {
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(summary ? { summary } : {}),
          lastActivityAt: new Date(),
        },
      });
      const bits = [
        status && `status -> ${status}`,
        priority && `priority -> ${priority}`,
        summary && "summary updated",
      ].filter(Boolean);
      saved({
        kind: "project_update",
        id: ref.id,
        summary: `Updated "${ref.name}"${bits.length ? `: ${bits.join(", ")}` : ""}`,
        undoable: false,
      });
      return `SAVED update to "${ref.name}"${bits.length ? `: ${bits.join(", ")}` : ""}.`;
    }
    case "create_task": {
      const title = str(input.title);
      if (!title) return "A task title is required.";
      if (input.allowDuplicate !== true) {
        const dup = await findDuplicateTask(title);
        if (dup) {
          return `DUPLICATE GUARD: an open task "${dup.title}"${dup.projectName ? ` on ${dup.projectName}` : ""} (id:${dup.id}) already exists. Nothing was created. Update or complete that task instead, or call create_task again with allowDuplicate: true if this is genuinely a different task.`;
        }
      }
      const ref = await resolveProject(input);
      const recurrence = str(input.recurrence)?.toLowerCase();
      const t = await prisma.jarvisTask.create({
        data: {
          title,
          projectId: ref?.id ?? null,
          priority: str(input.priority) ?? "medium",
          dueDate: parseDate(input.dueDate),
          recurrence: recurrence && RECURRENCES.has(recurrence) ? recurrence : null,
        },
      });
      await bump(ref?.id);
      const due = t.dueDate ? ` (due ${formatDate(t.dueDate)})` : "";
      const rec = t.recurrence ? ` [repeats ${t.recurrence}]` : "";
      saved({
        kind: "task",
        id: t.id,
        summary: `Task "${title}"${ref ? ` on ${ref.name}` : ""}${due}${rec}`,
        undoable: true,
      });
      return `SAVED task "${title}"${ref ? ` under ${ref.name}` : ""}${due}${rec} id:${t.id}.`;
    }
    case "create_tasks_bulk": {
      const items = Array.isArray(input.tasks) ? (input.tasks as Record<string, unknown>[]) : [];
      if (!items.length) return "tasks array is required.";
      const ref = await resolveProject(input);
      const made: string[] = [];
      for (const item of items.slice(0, 25)) {
        const title = str(item.title);
        if (!title) continue;
        let dueDate = parseDate(item.dueDate);
        const dueInDays = Number(item.dueInDays);
        if (!dueDate && Number.isFinite(dueInDays)) {
          dueDate = new Date(Date.now() + dueInDays * 864e5);
        }
        const recurrence = str(item.recurrence)?.toLowerCase();
        const t = await prisma.jarvisTask.create({
          data: {
            title,
            projectId: ref?.id ?? null,
            priority: str(item.priority) ?? "medium",
            dueDate,
            recurrence: recurrence && RECURRENCES.has(recurrence) ? recurrence : null,
          },
        });
        made.push(title);
        saved({
          kind: "task",
          id: t.id,
          summary: `Task "${title}"${ref ? ` on ${ref.name}` : ""}${dueDate ? ` (due ${formatDate(dueDate)})` : ""}`,
          undoable: true,
        });
      }
      await bump(ref?.id);
      return `SAVED ${made.length} tasks${ref ? ` under ${ref.name}` : ""}: ${made.join("; ")}.`;
    }
    case "complete_task": {
      const id = str(input.taskId);
      let task = id
        ? await prisma.jarvisTask.findUnique({ where: { id } })
        : null;
      if (!task) {
        const title = str(input.title);
        if (title) {
          task = await prisma.jarvisTask.findFirst({
            where: { title: { contains: title, mode: "insensitive" }, status: { not: "done" } },
          });
        }
      }
      if (!task) return "No matching open task found.";
      await prisma.jarvisTask.update({
        where: { id: task.id },
        data: { status: "done", completedAt: new Date() },
      });
      await bump(task.projectId);
      const nextDue = await respawnRecurringTask(task);
      saved({
        kind: "task_done",
        id: task.id,
        summary: `Completed "${task.title}"${nextDue ? ` (next: ${formatDate(nextDue)})` : ""}`,
        undoable: true,
      });
      return `SAVED: task "${task.title}" marked done.${nextDue ? ` It repeats ${task.recurrence}; the next occurrence is due ${formatDate(nextDue)}.` : ""}`;
    }
    case "log_note": {
      const body = str(input.body);
      if (!body) return "Note body is required.";
      const ref = await resolveProject(input);
      const n = await prisma.jarvisNote.create({
        data: { body, projectId: ref?.id ?? null },
      });
      await bump(ref?.id);
      void indexRecord("note", n.id, body);
      saved({
        kind: "note",
        id: n.id,
        summary: `Note${ref ? ` on ${ref.name}` : ""}: "${body.slice(0, 70)}${body.length > 70 ? "..." : ""}"`,
        undoable: true,
      });
      return `SAVED note${ref ? ` under ${ref.name}` : ""} id:${n.id}.`;
    }
    case "log_decision": {
      const title = str(input.title);
      const rationale = str(input.rationale);
      if (!title || !rationale) return "A decision needs a title and rationale.";
      const ref = await resolveProject(input);
      const d = await prisma.jarvisDecision.create({
        data: { title, rationale, projectId: ref?.id ?? null },
      });
      await bump(ref?.id);
      saved({
        kind: "decision",
        id: d.id,
        summary: `Decision${ref ? ` on ${ref.name}` : ""}: "${title}"`,
        undoable: true,
      });
      return `SAVED decision "${title}"${ref ? ` under ${ref.name}` : ""} id:${d.id}.`;
    }
    case "set_goal": {
      const title = str(input.title);
      if (!title) return "A goal title is required.";
      const g = await prisma.jarvisGoal.create({
        data: {
          title,
          description: str(input.description) ?? null,
          horizon: str(input.horizon) ?? null,
          targetDate: parseDate(input.targetDate),
        },
      });
      saved({ kind: "goal", id: g.id, summary: `Goal "${title}"`, undoable: true });
      return `SAVED goal "${title}" id:${g.id}.`;
    }
    case "file_document": {
      const docId = str(input.documentId);
      const summary = str(input.summary);
      if (!docId) return "documentId is required.";
      if (!summary) return "A summary is required.";
      const doc = await prisma.jarvisDocument.findUnique({ where: { id: docId } });
      if (!doc) return "Document not found.";
      const ref = await resolveProject(input);
      await prisma.jarvisDocument.update({
        where: { id: docId },
        data: { summary, ...(ref ? { projectId: ref.id } : {}) },
      });
      await bump(ref?.id);
      saved({
        kind: "document",
        id: docId,
        summary: `Filed "${doc.name}"${ref ? ` under ${ref.name}` : ""}`,
        undoable: false,
      });
      return `SAVED: document "${doc.name}" filed${ref ? ` under ${ref.name}` : ""} with summary.`;
    }

    case "save_document": {
      const docName = str(input.name);
      const content = str(input.content);
      if (!docName || !content) return "name and content are required.";
      const ref = await resolveProject(input);
      const d = await prisma.jarvisDocument.create({
        data: {
          name: docName.slice(0, 200),
          content: content.slice(0, 400_000),
          summary: str(input.summary) ?? null,
          projectId: ref?.id ?? null,
        },
      });
      await bump(ref?.id);
      void indexRecord("document", d.id, d.content, d.name);
      saved({
        kind: "document",
        id: d.id,
        summary: `Saved document "${docName}"${ref ? ` under ${ref.name}` : ""}`,
        undoable: true,
      });
      return `SAVED document "${docName}" [doc:${d.id}]${ref ? ` under ${ref.name}` : ""}.`;
    }
    case "add_milestone": {
      const title = str(input.title);
      if (!title) return "A milestone title is required.";
      const gid = str(input.goalId);
      let goal = gid ? await prisma.jarvisGoal.findUnique({ where: { id: gid } }) : null;
      if (!goal) {
        const gtitle = str(input.goalTitle);
        if (gtitle) {
          goal = await prisma.jarvisGoal.findFirst({
            where: { title: { contains: gtitle, mode: "insensitive" } },
          });
        }
      }
      if (!goal) return "No matching goal found. Provide goalId or goalTitle.";
      const m = await prisma.jarvisMilestone.create({
        data: { goalId: goal.id, title, dueDate: parseDate(input.dueDate) },
      });
      saved({
        kind: "goal",
        id: m.id,
        summary: `Milestone "${title}" added to goal "${goal.title}"`,
        undoable: false,
      });
      return `SAVED milestone "${title}" on goal "${goal.title}" [ms:${m.id}].`;
    }
    case "complete_milestone": {
      const mid = str(input.milestoneId);
      let ms = mid ? await prisma.jarvisMilestone.findUnique({ where: { id: mid }, include: { goal: true } }) : null;
      if (!ms) {
        const title = str(input.title);
        if (title) {
          ms = await prisma.jarvisMilestone.findFirst({
            where: { title: { contains: title, mode: "insensitive" }, done: false },
            include: { goal: true },
          });
        }
      }
      if (!ms) return "No matching open milestone found.";
      await prisma.jarvisMilestone.update({ where: { id: ms.id }, data: { done: true } });
      const remaining = await prisma.jarvisMilestone.count({
        where: { goalId: ms.goalId, done: false },
      });
      saved({
        kind: "goal",
        id: ms.id,
        summary: `Milestone done: "${ms.title}" (${ms.goal.title})`,
        undoable: false,
      });
      return `SAVED: milestone "${ms.title}" done on goal "${ms.goal.title}". ${remaining === 0 ? "That was the last open milestone: suggest the next one or ask if the goal is achieved." : `${remaining} milestone(s) remain.`}`;
    }
    case "link_source": {
      await ensureSyncTables();
      const source = str(input.source);
      const subject = str(input.subject);
      if (!source || !subject) return "source and subject are required.";
      const target = await resolveProject(input);
      if (!target) return "No matching project found. Create it first or give its exact name.";
      const old = await prisma.jarvisSourceLink.findUnique({ where: { source_subject: { source, subject } } });
      await prisma.jarvisSourceLink.upsert({
        where: { source_subject: { source, subject } },
        create: { source, subject, projectId: target.id },
        update: { projectId: target.id },
      });
      const moved = await prisma.jarvisActivity.updateMany({
        where: { subject, ...(old?.projectId ? { projectId: old.projectId } : {}) },
        data: { projectId: target.id },
      });
      let removed = "";
      if (old?.projectId && old.projectId !== target.id) {
        // Repoint every other link (e.g. the Netlify site of the same repo).
        await prisma.jarvisSourceLink.updateMany({ where: { projectId: old.projectId }, data: { projectId: target.id } });
        await prisma.jarvisActivity.updateMany({ where: { projectId: old.projectId }, data: { projectId: target.id } });
        const p = await prisma.jarvisProject.findUnique({
          where: { id: old.projectId },
          include: { _count: { select: { tasks: true, notes: true, decisions: true, documents: true } } },
        });
        const c = p?._count;
        if (p && p.summary?.startsWith("Auto-tracked") && c && !c.tasks && !c.notes && !c.decisions && !c.documents) {
          await prisma.jarvisProject.delete({ where: { id: p.id } });
          removed = ` Deleted the empty auto-created project "${p.name}".`;
        }
      }
      saved({ kind: "project_update", id: target.id, summary: `Linked ${subject} to ${target.name}`, undoable: false });
      return `Linked ${source} ${subject} to ${target.name}; moved ${moved.count} activity items.${removed}`;
    }
    case "ask_claude_code": {
      if (!process.env.GITHUB_TOKEN) return "GitHub is not connected (GITHUB_TOKEN missing in Netlify).";
      const title = str(input.title);
      const brief = str(input.brief);
      if (!title || !brief) return "title and brief are required.";
      let repo = str(input.repo);
      if (!repo) {
        await ensureSyncTables();
        const proj = await resolveProject({ projectName: input.projectName });
        const link = proj
          ? await prisma.jarvisSourceLink.findFirst({ where: { source: "github", projectId: proj.id } })
          : null;
        repo = link?.subject;
      }
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        return "Could not tell which GitHub repo to use. Ask the user, then pass repo as owner/name.";
      }
      const issue = await gh<{ number: number; html_url: string }>(`/repos/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title: title.slice(0, 250),
          body: `@claude ${brief}\n\n_Sent from Jarvis._`,
        }),
      });
      saved({ kind: "github_issue", id: String(issue.number), summary: `Claude Code job: ${repo}#${issue.number}`, undoable: false });
      return `Opened ${issue.html_url}. Claude Code will pick it up if the Claude GitHub app is installed on ${repo}; its pull request will show up in activity once it opens.`;
    }
    case "file_note": {
      const noteId = str(input.noteId);
      if (!noteId) return "noteId is required.";
      const note = await prisma.jarvisNote.findUnique({ where: { id: noteId } });
      if (!note) return "Note not found.";
      const ref = await resolveProject(input);
      if (!ref) return "No matching project. Provide projectId or projectName.";
      await prisma.jarvisNote.update({
        where: { id: noteId },
        data: { projectId: ref.id, source: null },
      });
      await bump(ref.id);
      saved({
        kind: "note",
        id: noteId,
        summary: `Filed inbox note under ${ref.name}: "${note.body.slice(0, 60)}${note.body.length > 60 ? "..." : ""}"`,
        undoable: false,
      });
      return `SAVED: inbox note filed under ${ref.name}.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
