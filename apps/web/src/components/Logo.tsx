import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

/**
 * The text logo: Sigmar One in primary with a sticker outline and shadow. The
 * big one is the page heading; the small one (screen headers) is decoration.
 */
export function Logo({ small = false, className }: { small?: boolean; className?: string }) {
  const Element = small ? "p" : "h1";
  return (
    <Element
      className={cn(
        "m-0 font-display leading-none font-normal tracking-wide text-primary",
        small ? "logo-outline-sm text-2xl" : "logo-outline text-5xl md:text-7xl",
        className,
      )}
    >
      {m.logo()}
    </Element>
  );
}
