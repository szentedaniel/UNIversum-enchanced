/**
 * The Deal composer and answer panel (#194, spec #172): the proposer picks the
 * recipient and what each side puts in, the recipient reads the terms and
 * answers with one action under their Turn timer. Both render from the pushed
 * view only and send through `sendIntent`.
 */
import type { Deal, PlayerId, PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { useState } from "react";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { sendIntent } from "#connection.ts";
import {
  dealCash,
  dealFields,
  dealProblem,
  dealProposal,
  dealRecipients,
  type DealDraft,
  type DealProblem,
} from "#deal/deal.ts";
import { cn } from "#lib/utils.ts";
import { TurnRing } from "#screens/TurnRing.tsx";
import { dealSideText, fieldName, formatMoney, m, playerName } from "#text.ts";
import { FIELDS } from "@universum/rules/board";

const PROBLEM_TEXT: Record<DealProblem, () => string> = {
  recipient: m.deal_problem_recipient,
  empty: m.deal_problem_empty,
  field: m.deal_problem_field,
  cash: m.deal_problem_cash,
};

/** A Player's name in the active language; `""` when the view does not carry them. */
function nameOf(view: PublicView, id: string): string {
  const player = view.players.find((candidate) => candidate.id === id);
  return player ? playerName(player.name) : "";
}

/** One side of a Deal the composer holds while its Fields change. */
function withSide(
  draft: DealDraft,
  side: "give" | "take",
  patch: Partial<DealDraft["give"]>,
): DealDraft {
  return side === "give"
    ? { ...draft, give: { ...draft.give, ...patch } }
    : { ...draft, take: { ...draft.take, ...patch } };
}

const fieldLabel = (id: FieldId) => fieldName(FIELDS[id]?.key ?? "");

export function DealComposer({
  view,
  me,
  onClose,
}: {
  view: PublicView;
  me: PlayerId;
  /** Closes the composer, back to the Roll or Quarantine choice. */
  onClose: () => void;
}) {
  const recipients = dealRecipients(view, me);
  const [draft, setDraft] = useState<DealDraft>(() => ({
    recipient: recipients[0] ?? null,
    give: { fields: [], cash: 0 },
    take: { fields: [], cash: 0 },
  }));
  const problem = dealProblem(view, me, draft);
  const chooseRecipient = (recipient: PlayerId) =>
    setDraft((current) => ({ ...current, recipient, take: { fields: [], cash: 0 } }));
  const toggle = (side: "give" | "take", field: FieldId) =>
    setDraft((current) => {
      const fields = current[side].fields.includes(field)
        ? current[side].fields.filter((id) => id !== field)
        : [...current[side].fields, field];
      return withSide(current, side, { fields });
    });
  const setCash = (side: "give" | "take", raw: string) => {
    const cash = Number.parseInt(raw, 10);
    setDraft((current) => withSide(current, side, { cash: Number.isFinite(cash) ? cash : 0 }));
  };
  const propose = () => {
    const intent = dealProposal(view, me, draft);
    if (intent !== null) sendIntent(intent);
  };
  return (
    <section
      data-testid="deal-composer"
      className="flex flex-col gap-2"
      aria-label={m.deal_title()}
    >
      <h2 className="m-0 font-display text-xl font-normal">{m.deal_title()}</h2>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="p-0 text-xs font-extrabold text-ink/70 uppercase">
          {m.deal_recipient()}
        </legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {recipients.map((recipient) => (
            <Button
              key={recipient}
              size="sm"
              className="min-h-11 min-w-11"
              variant={recipient === draft.recipient ? "default" : "plain"}
              aria-pressed={recipient === draft.recipient}
              data-testid="deal-recipient"
              onClick={() => chooseRecipient(recipient)}
            >
              {nameOf(view, recipient)}
            </Button>
          ))}
        </div>
      </fieldset>
      <FieldChoices
        testId="deal-give"
        label={m.deal_you_give()}
        options={dealFields(view, me)}
        fields={draft.give.fields}
        cash={draft.give.cash}
        maxCash={dealCash(view, me)}
        onToggle={(field) => toggle("give", field)}
        onCash={(raw) => setCash("give", raw)}
      />
      <FieldChoices
        testId="deal-take"
        label={m.deal_you_get()}
        options={dealFields(view, draft.recipient)}
        fields={draft.take.fields}
        cash={draft.take.cash}
        maxCash={dealCash(view, draft.recipient)}
        onToggle={(field) => toggle("take", field)}
        onCash={(raw) => setCash("take", raw)}
      />
      {problem !== null && (
        <p className="m-0 text-sm font-bold text-danger" data-testid="deal-problem">
          {PROBLEM_TEXT[problem]()}
        </p>
      )}
      <div className="sticky bottom-0 flex gap-2 bg-card pt-1">
        <Button
          className="flex-1"
          data-testid="deal-propose"
          disabled={problem !== null}
          onClick={propose}
        >
          {m.deal_propose()}
        </Button>
        <Button variant="plain" onClick={onClose}>
          {m.deal_cancel()}
        </Button>
      </div>
    </section>
  );
}

type FieldChoicesProps = {
  /** Prefix of the Field and cash test ids (`deal-give`, `deal-take`). */
  testId: string;
  label: string;
  /** The Fields this side may put in. */
  options: readonly FieldId[];
  fields: readonly FieldId[];
  cash: number;
  maxCash: number;
  onToggle: (field: FieldId) => void;
  onCash: (raw: string) => void;
};

/** One side's Fields and cash; its cash input never offers more than its payer holds. */
function FieldChoices({
  testId,
  label,
  options,
  fields,
  cash,
  maxCash,
  onToggle,
  onCash,
}: FieldChoicesProps) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="p-0 text-xs font-extrabold text-ink/70 uppercase">{label}</legend>
      {options.length === 0 ? (
        <p className="m-0 text-sm font-bold text-ink/60">{m.deal_nothing()}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((field) => {
            const picked = fields.includes(field);
            return (
              <button
                key={field}
                type="button"
                aria-pressed={picked}
                data-testid={`${testId}-field-${field}`}
                onClick={() => onToggle(field)}
                className={cn(
                  "sticker-sm press min-h-11 min-w-11 rounded-full px-2.5 py-1 text-sm font-extrabold",
                  picked ? "bg-success text-ink" : "bg-background text-ink/70",
                )}
              >
                {fieldLabel(field)}
              </button>
            );
          })}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm font-bold">
        <span className="min-w-0 flex-1 truncate">
          {m.deal_cash_max({ amount: formatMoney(maxCash) })}
        </span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={maxCash}
          step={1}
          className="h-11 w-28 text-right text-base"
          data-testid={`${testId}-cash`}
          value={cash}
          onChange={(event) => onCash(event.target.value)}
        />
      </label>
    </fieldset>
  );
}

export function DealAnswerPanel({
  view,
  deal,
  clockOffset,
  seat,
}: {
  view: PublicView;
  deal: Deal;
  /** Server clock minus this client's clock, from the push (`Push.clockOffset`). */
  clockOffset: number;
  /** This client's Seat: the answer timer shows their figure. */
  seat: number;
}) {
  const name = nameOf(view, deal.proposer);
  return (
    <section
      data-testid="deal-answer"
      aria-label={m.deal_from({ name })}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <h2
          className="m-0 min-w-0 flex-1 font-display text-xl leading-tight font-normal"
          data-testid="deal-from"
        >
          {m.deal_from({ name })}
        </h2>
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
      <p className="m-0 text-sm font-bold" data-testid="deal-answer-give">
        {m.deal_you_give()}: <span className="font-extrabold">{dealSideText(deal.take)}</span>
      </p>
      <p className="m-0 text-sm font-bold" data-testid="deal-answer-get">
        {m.deal_you_get()}: <span className="font-extrabold">{dealSideText(deal.give)}</span>
      </p>
      <div className="sticky bottom-0 flex gap-2 bg-card pt-1">
        <Button
          className="flex-1"
          data-testid="deal-accept"
          onClick={() => sendIntent({ type: "AcceptDeal", turn: view.turn })}
        >
          {m.deal_accept()}
        </Button>
        <Button
          variant="plain"
          data-testid="deal-decline"
          onClick={() => sendIntent({ type: "DeclineDeal", turn: view.turn })}
        >
          {m.deal_decline()}
        </Button>
      </div>
    </section>
  );
}
