/**
 * The chrome every pick tray shares (#125): the checklist and inspect toggles,
 * the Turn timer and the inspect hint. A tray hands it the heading and effect
 * line; the toggles' `uiStore` reads and writes live here once.
 */
import type { PublicView } from "@universum/rules";
import { Info, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { uiStore } from "#stores/ui-store.ts";
import { m } from "#text.ts";

type Props = {
  view: PublicView;
  /** Seat of this client's Player (the timer shows their figure). */
  seat: number;
  clockOffset: number;
  /** The tray's heading and effect line. */
  children: ReactNode;
};

export function TrayHeader({ view, seat, clockOffset, children }: Props) {
  const checklistOpen = useStore(uiStore, (state) => state.checklistOpen);
  const inspect = useStore(uiStore, (state) => state.inspect);
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={checklistOpen ? "default" : "plain"}
            size="icon-sm"
            aria-label={m.pick_checklist()}
            aria-pressed={checklistOpen}
            data-testid="pick-checklist-toggle"
            onClick={() => uiStore.getState().setChecklistOpen(!checklistOpen)}
          >
            <ListChecks size={18} strokeWidth={3} />
          </Button>
          <Button
            variant={inspect ? "default" : "plain"}
            size="icon-sm"
            aria-label={m.pick_inspect()}
            aria-pressed={inspect}
            data-testid="pick-inspect-toggle"
            onClick={() => uiStore.getState().setInspect(!inspect)}
          >
            <Info size={18} strokeWidth={3} />
          </Button>
          <TimerRing
            seat={seat}
            size={44}
            ring={
              view.turnTimer === null ? null : (
                <TurnRing
                  key={`${view.turn}:${view.turnDeadline}`}
                  timer={view.turnTimer}
                  clockOffset={clockOffset}
                />
              )
            }
          />
        </div>
      </div>
      {inspect && (
        <p className="m-0 text-xs font-bold text-primary" data-testid="pick-inspect-hint">
          {m.pick_inspect_hint()}
        </p>
      )}
    </>
  );
}
