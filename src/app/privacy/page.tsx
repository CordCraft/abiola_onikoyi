import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How abiolaonikoyi.com and the private Jarvis assistant handle data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-800">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Privacy</h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated 9 November 2026</p>

      <section className="mt-8 space-y-4 text-[15px] leading-7">
        <p>
          This site belongs to Abiola Onikoyi. Public pages collect no personal data beyond standard hosting logs.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-zinc-900">Jarvis</h2>
        <p>
          Jarvis is a private assistant used only by the site owner. When the owner connects his own Google or Microsoft
          accounts, Jarvis reads his email and calendar to summarise what needs his attention, suggest replies, and add
          events to his calendar. It sends email or messages only when the owner approves them.
        </p>
        <p>
          Data from Google APIs is used only to provide these features to the owner. It is not sold, not shared with
          third parties, not used for advertising, and not used to train general AI models. Jarvis&apos;s use of
          information received from Google APIs adheres to the{" "}
          <a className="text-indigo-600 underline" href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          Message text is stored in an encrypted-at-rest database for up to 120 days, then deleted. Access tokens are
          encrypted. The owner can disconnect any account at any time, which stops all access, and can revoke access from
          the Google or Microsoft account settings.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-zinc-900">Contact</h2>
        <p>
          Questions: <a className="text-indigo-600 underline" href="mailto:abiolaonikoyi@gmail.com">abiolaonikoyi@gmail.com</a>.
        </p>
        <p className="pt-6">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
            Back to the home page
          </Link>
        </p>
      </section>
    </main>
  );
}
