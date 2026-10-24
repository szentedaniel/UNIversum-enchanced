/**
 * The Sale tray (spec: Client → Pick flow; #29, #39): while this client sells
 * Fields, it sits where the Turn card was. It shows the Charge and the
 * Shortfall, the Turn timer, a meter of the picked sale value against the
 * Shortfall, the picks as chips (tap to remove), ⚡ Auto-sell and the one
 * commit button, "Sell N for X", which unlocks once the picks cover the
 * Shortfall. Picks are made by tapping the Board (see `Board.tsx`), or from the
 * checklist, which opens the way the Player last left it. Inspect mode opens
 * the Field card instead of picking.
 */
import type { PendingCharge, PublicView } from "@universum/rules";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { Info, ListChecks, X, Zap } from "lucide-react";
import { useMemo } from "react";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { cn } from "#lib/utils.ts";
import { saleChecklist } from "#pick/checklist.ts";
import { salePickedValue, type SalePick } from "#pick/sale.ts";
import { PickChecklist } from "#screens/PickChecklist.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { fieldName, formatCompactMoney, formatMoney, m } from "#text.ts";

const CHARGE_LABELS: Record<PendingCharge["kind"], (amount: string) => string> = {
  rent: (amount) => m.sale_charge_rent({ amount }),
  tax: (amount) => m.sale_charge_tax({ amount }),
  chanceCard: (amount) => m.sale_charge_chance_card({ amount }),
  timeoutPenalty: (amount) => m.sale_charge_timeout_penalty({ amount }),
};

type Props = {
  view: PublicView;
  sale: SalePick;
  picks: readonly FieldId[];
  /** Seat of this client's Player (the timer shows their figure). */
  seat: number;
  clockOffset: number;
  /** An intent is on its way: the buttons wait for the answer. */
  busy: boolean;
  /** The checklist is expanded (the Player's habit, persisted in `uiStore`). */
  checklistOpen: boolean;
  /** Inspect mode: Board taps open the Field card instead of picking. */
  inspect: boolean;
  onToggleChecklist: () => void;
  onToggleInspect: () => void;
  /** A checklist row: the Board's toggle for this Sale. */
  onToggle: (field: FieldId) => void;
  /** A checklist row: ring the Field and pan to it if hidden. */
  onFocus: (field: FieldId) => void;
  onUnpick: (field: FieldId) => void;
  onAutoSell: () => void;
  onSell: (fields: FieldId[]) => void;
};

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");

export function SaleTray({
  view,
  sale,
  picks,
  seat,
  clockOffset,
  busy,
  checklistOpen,
  inspect,
  onToggleChecklist,
  onToggleInspect,
  onToggle,
  onFocus,
  onUnpick,
  onAutoSell,
  onSell,
}: Props) {
  const picked = useMemo(
    () => picks.filter((id) => sale.pickable.includes(id)),
    [picks, sale.pickable],
  );
  const value = salePickedValue(view, picked);
  const covered = value >= sale.shortfall;
  const percent = Math.min(100, (value / sale.shortfall) * 100);
  const rows = useMemo(() => saleChecklist(sale, view), [sale, view]);
  return (
    <section
      aria-label={m.sale_title()}
      data-testid="sale-tray"
      data-board-obstacle
      className="sticker flex flex-col gap-2 rounded-ui bg-card p-3 text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs font-extrabold text-danger uppercase">
            {CHARGE_LABELS[sale.charge.kind](formatMoney(sale.charge.amount))} ·{" "}
            {m.sale_cash({ amount: formatMoney(sale.cash) })}
          </p>
          <h2 className="m-0 text-lg leading-tight font-black" data-testid="sale-shortfall">
            {m.sale_shortfall({ amount: formatMoney(sale.shortfall) })}
          </h2>
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
          {picked.length === 0 && (
            <li className="self-center text-sm font-bold text-ink/60">{m.sale_pick_hint()}</li>
          )}
          {picked.map((id) => (
            <li key={id}>
              <button
                type="button"
                aria-label={m.sale_remove({ field: fieldLabel(id) })}
                onClick={() => onUnpick(id)}
                className="sticker-sm press inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-sm font-extrabold text-ink"
              >
                {fieldLabel(id)}{" "}
                <span className="tnum">{formatCompactMoney(view.fields[id]?.sale ?? 0)}</span>
                <X size={14} strokeWidth={3} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <meter
          className="sr-only"
          aria-label={m.sale_meter()}
          min={0}
          max={sale.shortfall}
          value={Math.min(value, sale.shortfall)}
          aria-valuetext={`${formatMoney(value)} / ${formatMoney(sale.shortfall)}`}
        />
        <div
          aria-hidden="true"
          className="h-4 flex-1 overflow-hidden rounded-full border-[2.5px] border-border bg-background"
        >
          <div
            className={cn("h-full transition-all", covered ? "bg-success" : "bg-warning")}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="tnum shrink-0 text-xs font-extrabold" data-testid="sale-meter-text">
          {formatCompactMoney(value)} / {formatCompactMoney(sale.shortfall)}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="plain" disabled={busy} onClick={onAutoSell}>
          <Zap size={18} strokeWidth={3} aria-hidden="true" />
          {m.sale_auto_sell()}
        </Button>
        <Button className="tnum" disabled={busy || !covered} onClick={() => onSell(picked)}>
          {m.sale_sell({ count: picked.length, amount: formatCompactMoney(value) })}
        </Button>
      </div>
    </section>
  );
}
