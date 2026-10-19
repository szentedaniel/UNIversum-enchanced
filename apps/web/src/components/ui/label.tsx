/** shadcn/ui Label in the Tabletop look: small bold caps above a control. */
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- callers pass htmlFor or wrap the control
    <label
      data-slot="label"
      className={cn("text-sm font-extrabold tracking-wide uppercase opacity-70", className)}
      {...props}
    />
  );
}
