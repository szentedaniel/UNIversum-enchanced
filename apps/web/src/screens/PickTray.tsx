/**
 * The single-pick tray (spec: Client → Pick flow; #31, #39): during this
 * client's Doubler or Erasmus pick it sits where the Turn card was. It names
 * the action ("Put the Doubler on BUDAPEST", "Travel to LONDON"), shows the
 * chosen Field's effect (Rent now → after; Fields ahead and whether Start is
 * passed) and the Turn timer, with one commit button. Picks are made by
 * tapping the Board (see `Board.tsx`) or from the checklist; a tap never
 * commits. Inspect mode opens the Field card instead of picking.
 */
import type { PublicView } from "@universum/rules";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { Info, ListChecks, X } from "lucide-react";
import { useMemo } from "react";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { singleChecklist } from "#pick/checklist.ts";
import { selectedPick, type SinglePick } from "#pick/pick.ts";
import { PickChecklist } from "#screens/PickChecklist.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { fieldName, formatCompactMoney, m } from "#text.ts";

type Props = {
  view: PublicView;
  pick: SinglePick;
  /** The Field chosen for this decision (`uiStore.singlePick`). */
  selection: { key: string; field: FieldId | null };
  /** Seat of this client's Player (the timer shows their figure). */
  seat: number;
  clockOffset: number;
  /** An intent is on its way: the button waits for the answer. */
  busy: boolean;
  /** The checklist is expanded (the Player's habit, persisted in `uiStore`). */
  checklistOpen: boolean;
  /** Inspect mode: Board taps open the Field card instead of picking. */
  inspect: boolean;
  onToggleChecklist: () => void;
  onToggleInspect: () => void;
  /** A checklist row: the Board's selection for this pick. */
  onToggle: (field: FieldId) => void;
  /** A checklist row: ring the Field and pan to it if hidden. */
  onFocus: (field: FieldId) => void;
  /** Selects the Field, or clears the choice with `null`. */
  onPick: (field: FieldId | null) => void;
  onCommit: (field: FieldId) => void;
};

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");
const NO_PICKED: readonly FieldId[] = [];

export function PickTray({
  view,
  pick,
  selection,
  seat,
  clockOffset,
  busy,
  checklistOpen,
  inspect,
  onToggleChecklist,
  onToggleInspect,
  onToggle,
  onFocus,
  onPick,
  onCommit,
}: Props) {
  const chosen = selectedPick(pick, selection);
  const option = pick.options.find((candidate) => candidate.field === chosen);
  const rows = useMemo(() => singleChecklist(pick), [pick]);
  const picked = useMemo(() => (chosen === null ? NO_PICKED : [chosen]), [chosen]);
  const title = pick.kind === "doubler" ? m.pick_doubler_title() : m.pick_erasmus_title();
  const commit =
    chosen === null
      ? title
      : pick.kind === "doubler"
        ? m.pick_doubler_commit({ field: fieldLabel(chosen) })
        : m.pick_erasmus_commit({ field: fieldLabel(chosen) });
  return (
    <section
      aria-label={title}
      data-testid="pick-tray"
      data-board-obstacle
      className="sticker flex flex-col gap-2 rounded-ui bg-card p-3 text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs font-extrabold text-primary uppercase">{title}</p>
          {option?.kind === "doubler" && (
            <p className="m-0 text-lg leading-tight font-black" data-testid="pick-effect">
              {m.pick_doubler_rent({
                now: formatCompactMoney(option.rent),
                after: formatCompactMoney(option.rentAfter),
              })}
            </p>
          )}
          {option?.kind === "erasmus" && (
            <p className="m-0 text-lg leading-tight font-black" data-testid="pick-effect">
              {m.pick_erasmus_ahead({ count: option.steps })}
              {option.bonus === null
                ? ""
                : ` · ${m.pick_erasmus_start({ amount: formatCompactMoney(option.bonus) })}`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={checklistOpen ? "default" : "plain"}
            size="icon-sm"
            aria-label={m.pick_checklist()}
            aria-pressed={checklistOpen}
            data-testid="pick-checklist-toggle"
            onClick={onToggleChecklist}
          >
            <ListChecks size={18} strokeWidth={3} />
          </Button>
          <Button
            variant={inspect ? "default" : "plain"}
            size="icon-sm"
            aria-label={m.pick_inspect()}
            aria-pressed={inspect}
            data-testid="pick-inspect-toggle"
            onClick={onToggleInspect}
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
      {checklistOpen ? (
        <PickChecklist rows={rows} picked={picked} onToggle={onToggle} onFocus={onFocus} />
      ) : (
        <ul className="m-0 flex min-h-8 list-none flex-wrap gap-1.5 p-0">
          {chosen === null ? (
            <li className="self-center text-sm font-bold text-ink/60">{m.pick_hint()}</li>
          ) : (
            <li>
              <button
                type="button"
                aria-label={m.pick_remove({ field: fieldLabel(chosen) })}
                onClick={() => onPick(null)}
                className="sticker-sm press inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-sm font-extrabold text-ink"
              >
                {fieldLabel(chosen)}
                <X size={14} strokeWidth={3} aria-hidden="true" />
              </button>
            </li>
          )}
        </ul>
      )}
      <Button
        size="lg"
        disabled={busy || chosen === null}
        onClick={() => {
          if (chosen !== null) onCommit(chosen);
        }}
      >
        {commit}
      </Button>
    </section>
  );
}
