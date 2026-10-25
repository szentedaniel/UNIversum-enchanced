# The engine snapshots the board at each event

During a Playback the Player cards and the Board should show each event's effect at its own step, not the push's final view as soon as it arrives (#69). So the rules engine takes a snapshot of the Players, the Fields and the Doubler, with the numbers the UI shows (Rent, Value, Sale, Wealth), at every `emit`, and the push carries these `reveals` beside its events, one per event. The client shows the reveal of the latest event that has started and the final view once the Playback ends. Everything tied to the decision (phase, Turn, Turn timer, Auto-sell, pick options, standings) still comes from the final view behind the Decision gate. We chose this because only the engine knows the in-between Rent and Wealth: a Monopoly, the Doubler or a Museum count changes them in ways no event carries, so computing them on the client would break ADR-0001.

## Considered Options

- **Fold event deltas on the client** into the previous view: cash, owners, Levels and the Doubler fold cleanly, but Rent, Value, Sale and Wealth would need the pricing rules on the client, or would stay stale beside a half-revealed Board.
- **Per-event patches** of only the touched Players and Fields: a smaller push, but a second shape to keep in step with `PublicView`. It remains the fallback if the push size ever matters.

## Consequences

- A change shows with the first event emitted after it, so rule code applies an effect before emitting its event. A change with no event of its own (the PCR test from a Chance card) appears with the next event, or when the Playback ends.
- Bankruptcy emits in two beats: the Charge is paid first, then the Fields return to the Bank with `WentBankrupt`.
- Reveals are not kept in the event log stored next to the snapshot (ADR-0003). A push with no events (a reconnect) has none and shows the final view at once.
