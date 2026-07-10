import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

// Tool definitions handed to Claude. Read tools run immediately; propose_* tools
// only record a pending proposal that the user must confirm.
export const jarvisTools = [
  {
    name: "list_projects",
    description: "List projects, optionally filtered by status (idea|active|stalled|paused|done).",
    input_schema: {
      type: "object" as const,
      properties: { status: { type: "string", description: "Optional status filter" } },
    },
  },
  {
    name: "get_project",
    description: "Get one project's details (its tasks, recent notes and decisions). Provide id or name.",
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
    description: "Full-text-ish search across notes by keyword.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "propose_create_project",
    description: "Propose creating a new project. Requires user confirmation before it is saved.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        ventureName: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        summary: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "propose_update_project",
    description: "Propose updating a project's status/priority/summary. Requires confirmation.",
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
    name: "propose_create_task",
    description: "Propose creating a task, optionally under a project, with an optional due date (YYYY-MM-DD). Requires confirmation.",
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
    name: "propose_log_note",
    description: "Propose logging a note, optionally under a project. Requires confirmation.",
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
    name: "propose_log_decision",
    description: "Propose logging a decision and its rationale, optionally under a project. Requires confirmation.",
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
    name: "propose_set_goal",
    description: "Propose creating a long-term goal. Requires confirmation.",
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
];

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s || undefined;
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

async function propose(
  threadId: string | null,
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const p = await prisma.jarvisProposal.create({
    data: { threadId, kind, summary, payload: payload as object },
  });
  return `PROPOSED (id ${p.id}): ${summary}. This is not saved yet; it appears as a pending card for the user to Confirm or Discard. Tell the user what you proposed.`;
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  threadId: string | null,
): Promise<string> {
  const input = (rawInput ?? {}) as Input;

  switch (name) {
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
          notes: { orderBy: { createdAt: "desc" }, take: 8 },
          decisions: { orderBy: { createdAt: "desc" }, take: 8 },
        },
      });
      if (!p) return "Not found.";
      const parts = [
        `${p.name} [${p.status}, ${p.priority}]${p.venture ? ` venture:${p.venture.name}` : ""} id:${p.id}`,
        p.summary ? `Summary: ${p.summary}` : "",
        `Tasks:\n${p.tasks.map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${formatDate(t.dueDate)})` : ""}`).join("\n") || "  (none)"}`,
        `Notes:\n${p.notes.map((n) => `  - ${n.body.slice(0, 160)}`).join("\n") || "  (none)"}`,
        `Decisions:\n${p.decisions.map((d) => `  - ${d.title}: ${d.rationale.slice(0, 160)}`).join("\n") || "  (none)"}`,
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
            `- [${t.status}, ${t.priority}] ${t.title}${t.dueDate ? ` due ${formatDate(t.dueDate)}` : ""}${t.project ? ` (${t.project.name})` : ""}`,
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

    case "propose_create_project": {
      const name = str(input.name);
      if (!name) return "A project name is required.";
      const bits = [
        str(input.status) && `status ${str(input.status)}`,
        str(input.priority) && `priority ${str(input.priority)}`,
        str(input.ventureName) && `venture ${str(input.ventureName)}`,
      ].filter(Boolean);
      return propose(
        threadId,
        "create_project",
        `Create project "${name}"${bits.length ? ` (${bits.join(", ")})` : ""}`,
        {
          name,
          status: str(input.status),
          priority: str(input.priority),
          ventureName: str(input.ventureName),
          summary: str(input.summary),
        },
      );
    }
    case "propose_update_project": {
      const ref = await resolveProject(input);
      if (!ref) return "No matching project to update.";
      const bits = [
        str(input.status) && `status → ${str(input.status)}`,
        str(input.priority) && `priority → ${str(input.priority)}`,
        str(input.summary) && "summary updated",
      ].filter(Boolean);
      return propose(
        threadId,
        "update_project",
        `Update "${ref.name}"${bits.length ? `: ${bits.join(", ")}` : ""}`,
        {
          projectId: ref.id,
          status: str(input.status),
          priority: str(input.priority),
          summary: str(input.summary),
        },
      );
    }
    case "propose_create_task": {
      const title = str(input.title);
      if (!title) return "A task title is required.";
      const ref = await resolveProject(input);
      const due = str(input.dueDate);
      return propose(
        threadId,
        "create_task",
        `Add task "${title}"${ref ? ` to ${ref.name}` : ""}${due ? ` (due ${due})` : ""}`,
        {
          title,
          projectId: ref?.id ?? null,
          projectName: ref?.name ?? str(input.projectName) ?? null,
          priority: str(input.priority),
          dueDate: due ?? null,
        },
      );
    }
    case "propose_log_note": {
      const body = str(input.body);
      if (!body) return "Note body is required.";
      const ref = await resolveProject(input);
      return propose(
        threadId,
        "log_note",
        `Log note${ref ? ` on ${ref.name}` : ""}: "${body.slice(0, 60)}${body.length > 60 ? "…" : ""}"`,
        { body, projectId: ref?.id ?? null },
      );
    }
    case "propose_log_decision": {
      const title = str(input.title);
      const rationale = str(input.rationale);
      if (!title || !rationale) return "A decision needs a title and rationale.";
      const ref = await resolveProject(input);
      return propose(
        threadId,
        "log_decision",
        `Log decision${ref ? ` on ${ref.name}` : ""}: "${title}"`,
        { title, rationale, projectId: ref?.id ?? null },
      );
    }
    case "propose_set_goal": {
      const title = str(input.title);
      if (!title) return "A goal title is required.";
      return propose(threadId, "set_goal", `Create goal "${title}"`, {
        title,
        description: str(input.description),
        horizon: str(input.horizon),
        targetDate: str(input.targetDate),
      });
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
