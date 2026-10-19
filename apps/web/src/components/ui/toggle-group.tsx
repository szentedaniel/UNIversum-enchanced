/**
 * shadcn/ui ToggleGroup (on Base UI) in the Tabletop look: chunky segmented
 * choices (Players 2/3/4, Minute limit 15/30/50). The pressed item is primary.
 */
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "#lib/utils.ts";

export function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn("flex w-full gap-2", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem<Value extends string>({
  className,
  ...props
}: TogglePrimitive.Props<Value>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "sticker-sm press tnum h-12 flex-1 cursor-pointer rounded-xl bg-background text-lg font-black text-foreground disabled:opacity-40 data-pressed:bg-primary data-pressed:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}
