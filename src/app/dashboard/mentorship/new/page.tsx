import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { MenteeForm } from "@/components/mentorship/admin-forms";
import { currentIntakeCohort, listCohorts } from "@/lib/mentorship/cohorts";

export const metadata = { title: "Add mentee" };

export default async function NewMenteePage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  await verifySession();
  await ensureMentorshipTables();
  const { cohort } = await searchParams;
  const cohorts = (await listCohorts()).map((c) => ({
    id: c.id,
    label: c.label,
    closed: c.status === "closed",
  }));
  const intake = await currentIntakeCohort();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href="/dashboard/mentorship"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Mentorship
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Add a mentee
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Pre-register someone so their row is waiting for them. They finish
          setting up at abiolaonikoyi.com/mentorship/join with this email,
          choosing their own password. Copy the invite from their page next.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <MenteeForm
          mode="create"
          cohorts={cohorts}
          defaultCohort={cohorts.find((c) => c.id === cohort && !c.closed)?.id ?? intake.id}
        />
      </div>
    </div>
  );
}
