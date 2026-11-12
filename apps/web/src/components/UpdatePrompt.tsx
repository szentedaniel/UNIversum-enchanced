/**
 * Offers a refresh when the deployment serves a newer release (spec: Mobile
 * polish and installable PWA, Decision 3). A dismissible banner, not a modal:
 * its wrapper lets taps through, so an open Decision's tray stays usable. A
 * game in progress is never reloaded under the Player; that update arrives on
 * the next launch.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Button } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { canReload, watchForUpdate } from "#pwa/update.ts";
import { m } from "#text.ts";

/** Vite replaces this with the git SHA (`RELEASE`), the same release as the server. */
declare const CLIENT_RELEASE: string;

export function UpdatePrompt() {
  const [deployed, setDeployed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => watchForUpdate({ current: CLIENT_RELEASE, onUpdate: setDeployed }), []);

  // The live region exists from the first render, so screen readers announce a
  // prompt inserted later; the banner itself appears only on an update.
  const show = deployed !== null && !dismissed;
  const reloadable = canReload(pathname);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center p-safe-3"
    >
      {show && (
        <Card
          data-testid="update-prompt"
          className="pointer-events-auto w-full max-w-sm flex-row items-center gap-3 p-3"
        >
          <RefreshCw size={22} strokeWidth={2.5} aria-hidden className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm leading-tight font-black">{m.update_available()}</p>
            {!reloadable && (
              <p className="m-0 text-xs leading-tight font-bold text-ink/70">
                {m.update_in_game()}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {reloadable && (
              <Button size="sm" onClick={() => window.location.reload()}>
                {m.update_refresh()}
              </Button>
            )}
            <Button size="sm" variant="plain" onClick={() => setDismissed(true)}>
              {m.update_later()}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
