/**
 * The single-pick tray (spec: Client → Pick flow; #31, #39): during this
 * client's Doubler or Erasmus pick it sits where the Turn card was. It names
 * the action ("Put the Doubler on BUDAPEST", "Travel to LONDON"), shows the
 * chosen Field's effect (Rent now → after; Fields ahead and whether Start is
 * passed) and the Turn timer, with one commit button. Picks are made by
 * tapping the Board (see `Board.tsx`) or from the checklist; a tap never
 * commits. Inspect mode opens the Field card instead of picking. The tray owns
 * its `uiStore` wiring (the choice and the checklist preference live there) and
 * sends Place Doubler or Travel Erasmus itself (#125).
 */
import type { PublicView } from "@universum/rules";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { X } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { sendIntent } from "#connection.ts";
import type { BottomSlot } from "#decision/decision.ts";
import { singleChecklist } from "#pick/checklist.ts";
import { selectedPick } from "#pick/pick.ts";
import { PickChecklist } from "#screens/PickChecklist.tsx";
import { TrayHeader } from "#screens/TrayHeader.tsx";
import { uiStore } from "#stores/ui-store.ts";
import { fieldName, formatCompactMoney, m } from "#text.ts";

type Props = {
  view: PublicView;
  /** The bottom slot's pick: the value and whether an intent is in flight. */
  slot: Extract<BottomSlot, { kind: "pick" }>;
  /** Seat of this client's Player (the timer shows their figure). */
  seat: number;
  clockOffset: number;
};

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");
const NO_PICKED: readonly FieldId[] = [];

export function PickTray({ view, slot, seat, clockOffset }: Props) {
  const { pick, busy } = slot;
  const selection = useStore(uiStore, (state) => state.singlePick);
  const checklistOpen = useStore(uiStore, (state) => state.checklistOpen);
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
      <TrayHeader view={view} seat={seat} clockOffset={clockOffset}>
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
      </TrayHeader>
      {checklistOpen ? (
        <PickChecklist
          rows={rows}
          picked={picked}
          onToggle={(field) => uiStore.getState().choosePick(pick.key, field)}
          onFocus={(field) => uiStore.getState().focusPick(field)}
        />
      ) : (
        <ul className="m-0 flex min-h-8 list-none flex-wrap gap-1.5 p-0">
          {chosen === null ? (
            <li className="self-center text-sm font-bold text-ink/60">{m.pick_hint()}</li>
          ) : (
            <li>
              <button
                type="button"
                aria-label={m.pick_remove({ field: fieldLabel(chosen) })}
                onClick={() => uiStore.getState().choosePick(pick.key, null)}
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
          if (chosen === null) return;
          sendIntent(
            pick.kind === "doubler"
              ? { type: "PlaceDoubler", turn: view.turn, field: chosen }
              : { type: "TravelErasmus", turn: view.turn, field: chosen },
          );
        }}
      >
        {commit}
      </Button>
    </section>
  );
}
