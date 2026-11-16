/**
 * The result screen (R80): the podium in a scroll box, the way back to the
 * Lobby list, and the Summary switch over it. `PodiumBody` holds the podium
 * itself; this keeps the Summary's open state and the scroll box, while the
 * Game screen's Decision slot still decides when the Podium mounts.
 */
import type { PhaseOf, PlayerId, PublicView } from "@universum/rules";
import { useState } from "react";
import { Link } from "react-router";
import { PodiumBody } from "#components/PodiumBody.tsx";
import { Summary } from "#components/Summary.tsx";
import { buttonVariants } from "#components/ui/button.tsx";
import { playerLook } from "#players.ts";
import { m } from "#text.ts";

/** The backdrop's ink and the display text, as in the Tabletop prototype. */
const OVERLAY_BG = "#262335e6";

export function Podium({
  view,
  phase,
  rematch,
  me,
  busy,
}: {
  view: PublicView;
  phase: PhaseOf<"gameOver">;
  /** The Player ids that have agreed to a rematch, from the latest push (ticket #223). */
  rematch?: readonly PlayerId[];
  /** This client's Player id: a client without a Seat gets no rematch button. */
  me: PlayerId | null;
  /** True while this client's intent is unanswered (the in-flight lock). */
  busy: boolean;
}) {
  // The Summary is a local view of this screen: the Podium gate (shownTurn,
  // Playback) stays where it is, and a null Summary never opens.
  const [showSummary, setShowSummary] = useState(false);
  const summary = view.summary;
  // What is open, with the Summary itself, so the null view never opens one.
  const openSummary = showSummary ? summary : null;

  return (
    <section
      data-testid="podium"
      // `summary-title` labels the Summary alone while it is open.
      aria-labelledby={openSummary === null ? "podium-title" : undefined}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden p-safe-4"
      style={{ background: OVERLAY_BG }}
    >
      {Array.from({ length: 40 }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute top-0 h-3 w-2"
          style={{
            left: `${(i * 53) % 100}%`,
            background: playerLook(i % 4).color,
            animation: `confetti ${3 + (i % 5)}s linear ${-(i % 7)}s infinite`,
          }}
        />
      ))}
      {/* The result scrolls inside this box on a short phone; the way back to
          the Lobby list stays below it and never scrolls away. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto overscroll-contain">
        <div className="my-auto flex w-full flex-col items-center">
          {openSummary !== null ? (
            <Summary view={view} onBack={() => setShowSummary(false)} />
          ) : (
            <PodiumBody
              view={view}
              phase={phase}
              rematch={rematch}
              me={me}
              busy={busy}
              onOpenSummary={() => setShowSummary(true)}
            />
          )}
        </div>
      </div>
      <Link to="/rooms" className={buttonVariants({ className: "mt-6 shrink-0" })}>
        {m.back_to_list()}
      </Link>
    </section>
  );
}
