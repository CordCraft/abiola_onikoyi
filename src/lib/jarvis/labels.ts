// Plain labels shared by server and client components (a "use client" file cannot export plain values to server components).

export const resolvedByLabel: Record<string, string> = {
  reply: "You replied",
  reconcile: "Jarvis found it was done",
  expired: "It expired",
  manual: "Closed by hand",
  other_party: "Someone else handled it",
  cleanup: "Clean-up",
};
