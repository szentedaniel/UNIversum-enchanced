/**
 * The Decision tray (spec: Client → Pick flow; #29, #31, #39; #116): one tray
 * for this client's Sale and single pick, so the chrome exists once. `Game.tsx`
 * renders it from the Decision module's bottom slot; the checklist and inspect
 * toggles, the Turn timer, the expanded checklist, the chips and the commit all
 * live here, reading `uiStore` and sending through `sendIntent`. Only the body
 * differs: the Sale's meter, Auto-sell and Sell, or the pick's one commit.
 */
import type { PendingCharge, PickOption, PublicView } from "@universum/rules";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { Info, ListChecks, X, Zap } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "zustand";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { sendIntent } from "#connection.ts";
import type { BottomSlot } from "#decision/decision.ts";
import { cn } from "#lib/utils.ts";
import { saleChecklist, singleChecklist, type ChecklistRow } from "#pick/checklist.ts";
import { selectedPick, type SinglePick } from "#pick/pick.ts";
import { salePickedValue, salePicksFor, type SalePick } from "#pick/sale.ts";
import { TurnRing } from "#screens/TurnRing.tsx";
import { uiStore } from "#stores/ui-store.ts";
import { fieldName, formatCompactMoney, formatMoney, m } from "#text.ts";

const CHARGE_LABELS: Record<PendingCharge["kind"], (amount: string) => string> = {
  rent: (amount) => m.sale_charge_rent({ amount }),
  tax: (amount) => m.sale_charge_tax({ amount }),
  chanceCard: (amount) => m.sale_charge_chance_card({ amount }),
  chanceTransfer: (amount) => m.sale_charge_chance_card({ amount }),
  timeoutPenalty: (amount) => m.sale_charge_timeout_penalty({ amount }),
};

/** This client's Sale or single pick, as the Decision module's bottom slot. */
type TraySlot = Extract<BottomSlot, { kind: "sale" | "pick" }>;

type Props = {
  view: PublicView;
  slot: TraySlot;
  /** Server clock minus this client's clock, from the push (`Push.clockOffset`). */
  clockOffset: number;
  /** Seat of this client's Player (the timer shows their figure). */
  seat: number;
};

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");
const NO_PICKED: readonly FieldId[] = [];
const pickTitle = (pick: SinglePick): string =>
  pick.kind === "doubler" ? m.pick_doubler_title() : m.pick_erasmus_title();

export function DecisionTray({ view, slot, clockOffset, seat }: Props) {
  const checklistOpen = useStore(uiStore, (state) => state.checklistOpen);
  const inspect = useStore(uiStore, (state) => state.inspect);
  const salePicks = useStore(uiStore, (state) => state.salePicks);
  const singleSelection = useStore(uiStore, (state) => state.singlePick);
  const picked = useMemo(() => {
    if (slot.kind === "sale") {
      return salePicksFor(salePicks, slot.sale.key).filter((id) => slot.sale.pickable.includes(id));
    }
    const chosen = selectedPick(slot.pick, singleSelection);
    return chosen === null ? NO_PICKED : [chosen];
  }, [slot, salePicks, singleSelection]);
  const rows = useMemo(
    () => (slot.kind === "sale" ? saleChecklist(slot.sale, view) : singleChecklist(slot.pick)),
    [slot, view],
  );
  const chosen = slot.kind === "pick" ? (picked[0] ?? null) : null;
  const option =
    slot.kind === "pick" ? (slot.pick.options.find((item) => item.field === chosen) ?? null) : null;
  const toggle = (field: FieldId) => {
    if (slot.kind === "sale") uiStore.getState().toggleSalePick(slot.sale.key, field);
    else uiStore.getState().choosePick(slot.pick.key, field);
  };
  const remove = (field: FieldId) => {
    if (slot.kind === "sale") uiStore.getState().toggleSalePick(slot.sale.key, field);
    else uiStore.getState().choosePick(slot.pick.key, null);
  };
  return (
    <section
      aria-label={slot.kind === "sale" ? m.sale_title() : pickTitle(slot.pick)}
      data-testid={slot.kind === "sale" ? "sale-tray" : "pick-tray"}
      data-board-obstacle
      className="sticker flex flex-col gap-2 rounded-ui bg-card p-3 text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {slot.kind === "sale" ? (
            <SaleHeading sale={slot.sale} />
          ) : (
            <PickHeading pick={slot.pick} option={option} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={checklistOpen ? "default" : "plain"}
            size="icon-sm"
            className="min-h-11 min-w-11"
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
            className="min-h-11 min-w-11"
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
      {checklistOpen ? (
        <PickChecklist
          rows={rows}
          picked={picked}
          onToggle={toggle}
          onFocus={(field) => uiStore.getState().focusPick(field)}
        />
      ) : slot.kind === "sale" ? (
        <Picks
          picked={picked}
          hint={m.sale_pick_hint()}
          removeLabel={(field) => m.sale_remove({ field: fieldLabel(field) })}
          amountOf={(field) => formatCompactMoney(view.fields[field]?.sale ?? 0)}
          onRemove={remove}
        />
      ) : (
        <Picks
          picked={picked}
          hint={m.pick_hint()}
          removeLabel={(field) => m.pick_remove({ field: fieldLabel(field) })}
          onRemove={remove}
        />
      )}
      {slot.kind === "sale" ? (
        <SaleBody
          view={view}
          sale={slot.sale}
          picked={picked}
          busy={slot.busy}
          onAutoSell={() => sendIntent({ type: "AutoSell", turn: view.turn })}
          onSell={(fields) => sendIntent({ type: "SellFields", turn: view.turn, fields })}
        />
      ) : (
        <PickBody
          pick={slot.pick}
          chosen={chosen}
          busy={slot.busy}
          onCommit={(field) =>
            sendIntent(
              slot.pick.kind === "doubler"
                ? { type: "PlaceDoubler", turn: view.turn, field }
                : { type: "TravelErasmus", turn: view.turn, field },
            )
          }
        />
      )}
    </section>
  );
}

function SaleHeading({ sale }: { sale: SalePick }) {
  return (
    <>
      <p className="m-0 truncate text-xs font-extrabold text-danger uppercase">
        {CHARGE_LABELS[sale.charge.kind](formatMoney(sale.charge.amount))} ·{" "}
        {m.sale_cash({ amount: formatMoney(sale.cash) })}
      </p>
      <h2 className="m-0 text-lg leading-tight font-black" data-testid="sale-shortfall">
        {m.sale_shortfall({ amount: formatMoney(sale.shortfall) })}
      </h2>
    </>
  );
}

function PickHeading({ pick, option }: { pick: SinglePick; option: PickOption | null }) {
  return (
    <>
      <p className="m-0 truncate text-xs font-extrabold text-primary uppercase">
        {pickTitle(pick)}
      </p>
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
    </>
  );
}

type PicksProps = {
  picked: readonly FieldId[];
  /** Shown while nothing is picked. */
  hint: string;
  removeLabel: (field: FieldId) => string;
  /** The chip's amount, for a Sale. */
  amountOf?: (field: FieldId) => string;
  /** A chip tap: unpicks its Field (a pick clears the choice). */
  onRemove: (field: FieldId) => void;
};

function Picks({ picked, hint, removeLabel, amountOf, onRemove }: PicksProps) {
  return (
    <ul className="m-0 flex min-h-8 list-none flex-wrap gap-1.5 p-0">
      {picked.length === 0 && <li className="self-center text-sm font-bold text-ink/60">{hint}</li>}
      {picked.map((id) => (
        <li key={id}>
          <button
            type="button"
            aria-label={removeLabel(id)}
            onClick={() => onRemove(id)}
            className="sticker-sm press min-h-11 min-w-11 inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-sm font-extrabold text-ink"
          >
            {fieldLabel(id)}
            {amountOf !== undefined && (
              <>
                {" "}
                <span className="tnum">{amountOf(id)}</span>
              </>
            )}
            <X size={14} strokeWidth={3} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SaleBody({
  view,
  sale,
  picked,
  busy,
  onAutoSell,
  onSell,
}: {
  view: PublicView;
  sale: SalePick;
  picked: readonly FieldId[];
  busy: boolean;
  onAutoSell: () => void;
  onSell: (fields: FieldId[]) => void;
}) {
  const value = salePickedValue(view, picked);
  const covered = value >= sale.shortfall;
  const percent = Math.min(100, (value / sale.shortfall) * 100);
  return (
    <>
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
      <div className="sticky bottom-0 grid grid-cols-[auto_1fr] gap-2 bg-card pt-1">
        <Button variant="plain" disabled={busy} onClick={onAutoSell}>
          <Zap size={18} strokeWidth={3} aria-hidden="true" />
          {m.sale_auto_sell()}
        </Button>
        <Button className="tnum" disabled={busy || !covered} onClick={() => onSell([...picked])}>
          {m.sale_sell({ count: picked.length, amount: formatCompactMoney(value) })}
        </Button>
      </div>
    </>
  );
}

function PickBody({
  pick,
  chosen,
  busy,
  onCommit,
}: {
  pick: SinglePick;
  chosen: FieldId | null;
  busy: boolean;
  onCommit: (field: FieldId) => void;
}) {
  const commit =
    chosen === null
      ? pickTitle(pick)
      : pick.kind === "doubler"
        ? m.pick_doubler_commit({ field: fieldLabel(chosen) })
        : m.pick_erasmus_commit({ field: fieldLabel(chosen) });
  return (
    <Button
      size="lg"
      className="sticky bottom-0"
      disabled={busy || chosen === null}
      onClick={() => {
        if (chosen !== null) onCommit(chosen);
      }}
    >
      {commit}
    </Button>
  );
}

/**
 * The tray's expandable Field checklist (spec: Client → Pick flow; #39): one
 * row per pickable Field, in the order `pick/checklist.ts` gives, toggling the
 * same picks as the Board. A row also focuses its Field on the Board, which
 * pans to it only if it is hidden and never zooms (see Board.tsx).
 */
function PickChecklist({
  rows,
  picked,
  onToggle,
  onFocus,
}: {
  rows: readonly ChecklistRow[];
  picked: readonly FieldId[];
  /** Toggles the row's Field in the pick (the Board's own toggle). */
  onToggle: (field: FieldId) => void;
  /** Rings the Field on the Board and pans to it if hidden. */
  onFocus: (field: FieldId) => void;
}) {
  return (
    <ul
      className="m-0 flex max-h-44 list-none flex-col gap-1 overflow-y-auto p-0"
      data-testid="pick-checklist"
    >
      {rows.map((row) => {
        const on = picked.includes(row.field);
        return (
          <li key={row.field}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(row.field);
                onFocus(row.field);
              }}
              className={cn(
                "sticker-sm press min-h-11 min-w-11 flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm font-extrabold",
                on ? "bg-success text-ink" : "bg-background text-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{fieldLabel(row.field)}</span>
              {row.kind === "sale" && row.auto && (
                <span className="shrink-0 rounded-full bg-warning px-1.5 text-[10px] leading-4 font-extrabold text-ink">
                  {m.sale_auto_sell()}
                </span>
              )}
              <span
                className={cn(
                  "tnum shrink-0 text-xs font-bold",
                  on ? "text-ink/70" : "text-muted-foreground",
                )}
              >
                {effect(row)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function effect(row: ChecklistRow): string {
  switch (row.kind) {
    case "sale":
      return formatCompactMoney(row.sale);
    case "doubler":
      return row.rent === null || row.rentAfter === null
        ? ""
        : m.pick_doubler_rent({
            now: formatCompactMoney(row.rent),
            after: formatCompactMoney(row.rentAfter),
          });
    case "erasmus":
      return row.bonus === null
        ? m.pick_erasmus_ahead({ count: row.steps })
        : `${m.pick_erasmus_ahead({ count: row.steps })} · ${m.pick_erasmus_start({
            amount: formatCompactMoney(row.bonus),
          })}`;
    default:
      return "";
  }
}
