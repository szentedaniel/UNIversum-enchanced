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
          {facts.basePrice !== null && (
            <p
              data-testid="field-card-base-price"
              className="mx-4 mt-2 mb-0 flex items-center justify-center gap-1 text-sm font-extrabold"
            >
              <span className="text-ink/60">{m.field_card_base_price()}</span>
              <span className="tnum">{formatMoney(facts.basePrice)}</span>
            </p>
          )}
          {facts.levelRents.length > 0 && (
            <ul
              aria-label={m.field_card_level_rents()}
              data-testid="field-card-level-rents"
              className="mx-4 mt-2 mb-0 grid list-none grid-cols-4 gap-1 p-0 text-center"
            >
              {facts.levelRents.map((rent, index) => {
                const level = index + 1;
                const current = level === facts.level;
                return (
                  <li
                    key={level}
                    data-testid="field-card-level-rent"
                    data-level={level}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex flex-col rounded-lg py-1",
                      current ? "bg-primary text-primary-foreground" : "bg-secondary/30",
                    )}
                  >
                    <span className="text-[0.6rem] leading-tight font-bold opacity-70">
                      {m.field_card_level()} {level}
                    </span>
                    <span className="tnum text-xs leading-tight font-black">
                      {formatMoney(rent)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {facts.group && (
            <div
              data-testid="field-card-group"
              className="mx-4 mt-2 rounded-xl bg-secondary/30 px-2 py-1"
            >
              <p className="m-0 flex items-center justify-center gap-2 text-xs font-bold text-ink/60">
                {m.field_card_group()}
                {facts.monopoly && (
                  <span
                    data-testid="field-card-monopoly"
                    className="rounded-full bg-accent px-2 py-0.5 text-ink"
                  >
                    {m.field_card_monopoly()}
                  </span>
                )}
              </p>
              <ul className="m-0 mt-1 flex list-none flex-wrap justify-center gap-1 p-0">
                {facts.group.map((member) => (
                  <li
                    key={member.field.id}
                    data-testid="field-card-group-field"
                    data-field={member.field.id}
                    data-owner={member.owner?.id ?? ""}
                    className={cn(
                      "flex min-w-0 items-center gap-1 rounded-lg bg-card px-1.5 py-0.5 text-xs font-extrabold",
                      member.owner === null && "text-ink/50",
                    )}
                  >
                    {member.owner && <PlayerToken seat={member.owner.seat} size={16} />}
                    <span className="truncate">{fieldName(member.field.key)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.doublers > 0 && (
            <p
              data-testid="field-card-doubler"
              className="mx-4 mt-2 mb-0 flex items-center justify-center rounded-xl bg-accent/60 py-1 text-sm font-extrabold"
            >
              {m.field_card_doubler({ count: facts.doublers })}
            </p>
          )}
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
