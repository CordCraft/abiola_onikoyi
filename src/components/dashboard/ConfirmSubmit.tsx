"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/mentorship/Spinner";

// A submit button that asks for confirmation before allowing the form's
// (server) action to run, then shows a spinner while it does. Used for
// destructive deletes.
export function ConfirmSubmit({
  children,
  message,
  className,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="h-3 w-3" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
