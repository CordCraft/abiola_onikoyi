import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { ensureMentorshipTables } from "@/lib/mentorship/setup";
import { MenteeForm } from "@/components/mentorship/admin-forms";

export const metadata = { title: "Add mentee" };

export default async function NewMenteePage() {
  await verifySession();
  await ensureMentorshipTables();

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
          An access code is generated automatically. Share it privately (for
          example on WhatsApp) together with the portal link.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <MenteeForm mode="create" />
      </div>
    </div>
  );
}
