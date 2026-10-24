/** shadcn/ui Input (on Base UI) in the Tabletop look. */
import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

export function Input({ className, ...props }: ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-xl border-[2.5px] border-input bg-card px-3 text-lg font-bold text-card-foreground outline-none placeholder:text-ink/50 focus-visible:bg-secondary/40 disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
