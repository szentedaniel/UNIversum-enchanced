import type { PublicView } from "@universum/rules";
import { FIELD_COUNT, type FieldId } from "@universum/rules/board";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CSSProperties } from "react";
import { GROUP_COLORS, KIND_COLORS } from "#board/colors.ts";
import { fieldFacts } from "#board/field-facts.ts";
import { PlayerToken } from "#components/PlayerToken.tsx";
import { Button } from "#components/ui/button.tsx";
import { cn } from "#lib/utils.ts";
import { stepThrough } from "#pick/checklist.ts";
import { uiStore } from "#stores/ui-store.ts";
import { fieldKindName, fieldName, formatMoney, m, playerName } from "#text.ts";

const bands = new Map<number, CSSProperties>();
/** One shared style object per band colour, so renders don't create new ones. */
function band(color: number): CSSProperties {
  let style = bands.get(color);
  if (!style) {
    style = { background: `#${color.toString(16).padStart(6, "0")}` };
    bands.set(color, style);
  }
  return style;
}

const money = (value: number | null) => (value === null ? m.field_card_none() : formatMoney(value));

const step = (id: FieldId, by: number, through?: readonly FieldId[]) =>
  through === undefined
    ? (id + by + FIELD_COUNT) % FIELD_COUNT
    : (stepThrough(through, id, by) ?? id);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-bold text-ink/60">{label}</dt>
      <dd className="tnum m-0 text-lg leading-tight font-black">{value}</dd>
    </div>
  );
}

/**
 * The Field card: a Group-colour band with the kind and name, Rent / Level /
 * Value tiles and the owner, and ‹ › to step round the ring. The screen places
 * it (a bottom sheet in portrait, a compact card on landscape and desktop).
 * Opening or stepping never zooms the Board; the Board pans only if the Field
 * would be hidden under this card (`data-board-obstacle`).
 */
export function FieldCard({
  id,
  view,
  className,
  stepThrough: through,
}: {
  id: FieldId;
  view: PublicView;
  className?: string;
  /**
   * During a pick's inspect mode, ‹ › step through these pickable Fields only;
   * omitted, they step round the whole ring.
   */
  stepThrough?: readonly FieldId[];
}) {
  const facts = fieldFacts(view, id);
  if (!facts) return null;
  const { field, owner } = facts;

  return (
    <section
      aria-label={m.field_card()}
      data-testid="field-card"
      data-board-obstacle
      className={cn(
        "sticker flex flex-col overflow-hidden rounded-ui bg-card text-card-foreground",
        className,
      )}
    >
      <header
        className="flex items-center justify-between gap-2 border-b-[3px] border-border px-4 py-2 text-ink"
        style={band(field.group ? GROUP_COLORS[field.group] : KIND_COLORS[field.kind])}
      >
        <div className="min-w-0">
          <p className="m-0 text-xs font-extrabold uppercase opacity-75">
            {fieldKindName(field.kind)}
          </p>
          <h2 className="m-0 truncate font-display text-2xl leading-tight font-normal">
            {fieldName(field.key)}
          </h2>
        </div>
        <Button
          variant="plain"
          size="icon-sm"
          aria-label={m.field_card_close()}
          onClick={() => uiStore.getState().selectField(null)}
        >
          <X size={18} strokeWidth={3} />
        </Button>
      </header>
      {facts.ownable && (
        <>
          <dl className="m-0 grid grid-cols-3 gap-2 px-4 pt-2 text-center">
            <Stat label={m.field_card_rent()} value={money(facts.rent)} />
            <Stat
              label={m.field_card_level()}
              value={facts.level > 0 ? String(facts.level) : m.field_card_none()}
            />
            <Stat label={m.field_card_value()} value={money(facts.value)} />
          </dl>
          <p className="mx-4 mt-2 mb-0 flex items-center justify-center gap-2 rounded-xl bg-secondary/40 py-1 text-sm font-extrabold">
            {owner ? (
              <>
                <PlayerToken seat={owner.seat} size={20} />
                <span className="truncate">
                  {m.field_card_owner()}: {playerName(owner.name)}
                </span>
              </>
            ) : (
              m.field_card_unowned()
            )}
          </p>
        </>
      )}
      <nav className="flex justify-between gap-2 p-2">
        <Button
          variant="plain"
          size="sm"
          aria-label={m.field_card_previous()}
          onClick={() => uiStore.getState().selectField(step(id, -1, through))}
        >
          <ChevronLeft strokeWidth={3} />
        </Button>
        <Button
          variant="plain"
          size="sm"
          aria-label={m.field_card_next()}
          onClick={() => uiStore.getState().selectField(step(id, 1, through))}
        >
          <ChevronRight strokeWidth={3} />
        </Button>
      </nav>
    </section>
  );
}
