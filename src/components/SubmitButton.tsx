"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/mentorship/Spinner";

// Drop-in replacement for a plain <button type="submit"> inside a <form
// action={...}>: disables itself and shows a spinner while the action runs,
// so every one-click operation on the site gives immediate feedback. Works
// in both plain forms and useActionState forms (useFormStatus reads the
// nearest form's pending state).

type Props = ComponentProps<"button"> & {
  // Icon-style buttons (checkboxes, x buttons) replace their content with
  // the spinner; text buttons keep their label and gain a spinner in front.
  iconOnly?: boolean;
  spinnerClassName?: string;
  pendingLabel?: ReactNode;
};

export function SubmitButton({
  children,
  iconOnly = false,
  spinnerClassName = "h-3.5 w-3.5",
  pendingLabel,
  disabled,
  ...rest
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      {...rest}
    >
      {pending ? (
        iconOnly ? (
          <Spinner className={spinnerClassName} />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className={spinnerClassName} />
            {pendingLabel ?? children}
          </span>
        )
      ) : (
        children
      )}
    </button>
  );
}
