# The rules engine times the Playback

Clients show what an intent set off (the Roll, the pawn's hops, money changes, a Chance card for 7 s) before the next decision, and Players asked that the next Turn and its timer start only once that Playback has ended, everywhere at once. So the rules engine estimates the Playback's length from the events it emits, using fixed rules constants per event, and stores `actsAfter = ctx.now + playback`: it rejects intents for the next decision before `actsAfter`, and the `turnDeadline` runs from `actsAfter`. This extends ADR 0003 rather than breaking it. The engine still has no timers and reads only `ctx.now`, but it now knows how long the client takes to show each event, so a change to an animation's length is a rules change.

## Considered Options

- **Client-only wait**: hide the controls until the local Playback ends and leave the server as it is. Rejected because the timer would run during the Playback, and one fast click (or an intent sent from the console) would cut off everyone else's Playback.
- **Client wait plus a longer deadline**: rejected for the same cut-off problem; only a server-held `actsAfter` makes the next Turn start on every screen together.

## Consequences

- Closing a Chance card early hides it locally but does not start the next decision sooner.
- A reconnecting client that gets no events still hides the controls until `actsAfter`, by the server's clock.
