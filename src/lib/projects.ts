import "server-only";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";

export * from "@/lib/project-constants";

// All reads verify the session first (defense in depth alongside the proxy).
export async function getProjects() {
  await verifySession();
  return prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      updates: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { updates: true } },
    },
  });
}

export async function getProject(id: string) {
  await verifySession();
  return prisma.project.findUnique({
    where: { id },
    include: { updates: { orderBy: { createdAt: "desc" } } },
  });
}
