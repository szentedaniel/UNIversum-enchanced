import type { PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import type { CSSProperties } from "react";
import { useStore } from "zustand";
import { GROUP_COLORS, KIND_COLORS, PLAYER_COLORS } from "#board/colors.ts";
import { fieldFacts } from "#board/field-facts.ts";
import { uiStore } from "#stores/ui-store.ts";
import { fieldKindName, fieldName, formatMoney, m, playerName } from "#text.ts";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const backgrounds = new Map<number, CSSProperties>();
/** One shared style object per colour, so renders don't create new ones. */
function background(color: number): CSSProperties {
  let style = backgrounds.get(color);
  if (!style) {
    style = { background: hex(color) };
    backgrounds.set(color, style);
  }
  return style;
}
const amount = (value: number | null) =>
  value === null ? m.field_card_none() : formatMoney(value);
/** The shape cue next to each Player colour, by Seat. */
const SEAT_SHAPES = ["●", "▲", "■", "★"];

/**
 * The Field card for the Field open in `uiStore`: a Group-colour band with the
 * kind and name, Rent / Level / Value tiles and the owner, and ‹ › to step
 * round the ring. A bottom sheet in portrait, a compact card on landscape and
 * desktop (styles.css). Opening or stepping never zooms the Board; the Board
 * pans only if the Field would be hidden under this card (`data-board-obstacle`).
 */
export function FieldCard({ view }: { view: PublicView }) {
  const id = useStore(uiStore, (s) => s.selectedField);
  const facts = id === null ? null : fieldFacts(view, id);
  if (id === null || !facts) {
    return <p className="board-hint">{m.board_tap_hint()}</p>;
  }

  const { field, owner } = facts;
  const band = field.group ? GROUP_COLORS[field.group] : KIND_COLORS[field.kind];
  const step = (by: number) =>
    uiStore.getState().selectField((id + by + FIELD_COUNT) % FIELD_COUNT);

  return (
    <section
      className="field-card"
      aria-label={m.field_card()}
      data-testid="field-card"
      data-board-obstacle
    >
      <header className="field-card-band" style={background(band)}>
        <div>
          <p className="field-card-kind">{fieldKindName(field.kind)}</p>
          <h2 className="field-card-name">{fieldName(field.key)}</h2>
        </div>
        <button
          type="button"
          className="field-card-close"
          aria-label={m.field_card_close()}
          onClick={() => uiStore.getState().selectField(null)}
        >
          ✕
        </button>
      </header>
      {facts.ownable && (
        <>
          <dl className="field-card-tiles">
            <div>
              <dt>{m.field_card_rent()}</dt>
              <dd>{amount(facts.rent)}</dd>
            </div>
            <div>
              <dt>{m.field_card_level()}</dt>
              <dd>{facts.level > 0 ? facts.level : m.field_card_none()}</dd>
            </div>
            <div>
              <dt>{m.field_card_value()}</dt>
              <dd>{amount(facts.value)}</dd>
            </div>
          </dl>
          <p className="field-card-owner">
            {owner ? (
              <>
                <span
                  className="token"
                  aria-hidden="true"
                  style={background(PLAYER_COLORS[owner.seat] ?? 0xffffff)}
                >
                  {SEAT_SHAPES[owner.seat]}
                </span>
                <span>
                  {m.field_card_owner()}: {playerName(owner.name)}
                </span>
              </>
            ) : (
              m.field_card_unowned()
            )}
          </p>
        </>
      )}
      <nav className="field-card-nav">
        <button type="button" aria-label={m.field_card_previous()} onClick={() => step(-1)}>
          ‹
        </button>
        <button type="button" aria-label={m.field_card_next()} onClick={() => step(1)}>
          ›
        </button>
      </nav>
    </section>
  );
}
