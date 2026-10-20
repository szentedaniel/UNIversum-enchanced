/**
 * The language picker (home and the in-game menu): Hungarian, English or
 * German, each named in its own language. Picking one saves the choice and
 * reloads the page; the Guest token then brings the Player back to their Seat.
 */
import { Button } from "#components/ui/button.tsx";
import { cn } from "#lib/utils.ts";
import { getLocale, locales, setLocale } from "#paraglide/runtime.js";
import { m } from "#text.ts";

const NAMES: Record<(typeof locales)[number], () => string> = {
  hu: m.language_hu,
  en: m.language_en,
  de: m.language_de,
};

export function LanguagePicker({ className }: { className?: string }) {
  const current = getLocale();
  return (
    <fieldset
      className={cn("m-0 flex flex-wrap items-center justify-center gap-2 border-0 p-0", className)}
    >
      <legend className="sr-only">{m.language()}</legend>
      {locales.map((locale) => (
        <Button
          key={locale}
          variant={locale === current ? "default" : "plain"}
          size="sm"
          aria-pressed={locale === current}
          data-testid={`language-${locale}`}
          onClick={() => void setLocale(locale)}
        >
          {NAMES[locale]()}
        </Button>
      ))}
    </fieldset>
  );
}
