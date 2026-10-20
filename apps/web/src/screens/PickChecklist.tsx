/**
 * The tray's expandable Field checklist (spec: Client → Pick flow; #39): one
 * row per pickable Field, in the order `pick/checklist.ts` gives, toggling the
 * same picks as the Board. A row also focuses its Field on the Board, which
 * pans to it only if it is hidden and never zooms (see Board.tsx).
 */
import { FIELDS, type FieldId } from "@universum/rules/board";
import { cn } from "#lib/utils.ts";
import type { ChecklistRow } from "#pick/checklist.ts";
import { fieldName, formatCompactMoney, m } from "#text.ts";

type Props = {
  rows: readonly ChecklistRow[];
  picked: readonly FieldId[];
  /** Toggles the row's Field in the pick (the Board's own toggle). */
  onToggle: (field: FieldId) => void;
  /** Rings the Field on the Board and pans to it if hidden. */
  onFocus: (field: FieldId) => void;
};

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");

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

export function PickChecklist({ rows, picked, onToggle, onFocus }: Props) {
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
                "sticker-sm press flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm font-extrabold",
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
