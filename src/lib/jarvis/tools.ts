import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

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
    | "document";
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
      "Create a task, optionally under a project, with an optional due date (YYYY-MM-DD). Applies immediately.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        projectName: { type: "string" },
        projectId: { type: "string" },
        priority: { type: "string" },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["title"],
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
      const ns = await prisma.jarvisNote.findMany({
        where: { body: { contains: q, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { project: { select: { name: true } } },
      });
      if (!ns.length) return "(no matching notes)";
      return ns
        .map((n) => `- ${n.project ? `(${n.project.name}) ` : ""}${n.body.slice(0, 220)}`)
        .join("\n");
    }
    case "search_documents": {
      const q = str(input.query) ?? "";
      if (!q) return "A query is required.";
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
      if (!docs.length) return "(no matching documents)";
      return docs
        .map((d) => {
          const idx = d.content.toLowerCase().indexOf(q.toLowerCase());
          const snippet =
            idx >= 0
              ? d.content.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, " ")
              : d.content.slice(0, 160).replace(/\s+/g, " ");
          return `- ${d.name}${d.project ? ` (${d.project.name})` : ""} [doc:${d.id}]\n  ...${snippet}...`;
        })
        .join("\n");
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
      const ref = await resolveProject(input);
      const t = await prisma.jarvisTask.create({
        data: {
          title,
          projectId: ref?.id ?? null,
          priority: str(input.priority) ?? "medium",
          dueDate: parseDate(input.dueDate),
        },
      });
      await bump(ref?.id);
      const due = t.dueDate ? ` (due ${formatDate(t.dueDate)})` : "";
      saved({
        kind: "task",
        id: t.id,
        summary: `Task "${title}"${ref ? ` on ${ref.name}` : ""}${due}`,
        undoable: true,
      });
      return `SAVED task "${title}"${ref ? ` under ${ref.name}` : ""}${due} id:${t.id}.`;
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
      saved({
        kind: "task_done",
        id: task.id,
        summary: `Completed "${task.title}"`,
        undoable: true,
      });
      return `SAVED: task "${task.title}" marked done.`;
    }
    case "log_note": {
      const body = str(input.body);
      if (!body) return "Note body is required.";
      const ref = await resolveProject(input);
      const n = await prisma.jarvisNote.create({
        data: { body, projectId: ref?.id ?? null },
      });
      await bump(ref?.id);
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

    default:
      return `Unknown tool: ${name}`;
  }
}
