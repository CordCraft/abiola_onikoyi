import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { MessageForm } from "@/components/mentorship/forms";
import { EmptyState } from "@/components/mentorship/ui";
import { formatDateTime } from "@/lib/format";

export default async function MessagesPage() {
  const mentee = await verifyMentee();

  // Opening the thread marks the mentor's messages as read.
  await prisma.mentorshipMessage.updateMany({
    where: { menteeId: mentee.id, sender: "mentor", readAt: null },
    data: { readAt: new Date() },
  });

  const messages = await prisma.mentorshipMessage.findMany({
    where: { menteeId: mentee.id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Messages
        </h1>
        <p className="mt-1 text-zinc-400">
          A direct, private line to your mentor. No question is too small.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
        {messages.length === 0 ? (
          <EmptyState>
            No messages yet. Say hello, or ask the question you have been sitting
            on.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const mine = m.sender === "mentee";
              return (
                <li
                  key={m.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[70%] ${
                      mine
                        ? "rounded-br-md bg-accent/15 text-zinc-100"
                        : "rounded-bl-md bg-white/[0.07] text-zinc-200"
                    }`}
                  >
                    <p className="whitespace-pre-line text-sm leading-relaxed">
                      {m.body}
                    </p>
                    <p className="mt-1 text-right text-[11px] text-zinc-500">
                      {mine ? "You" : "Mentor"} · {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 border-t border-white/10 pt-4">
          <MessageForm />
        </div>
      </div>
    </div>
  );
}
