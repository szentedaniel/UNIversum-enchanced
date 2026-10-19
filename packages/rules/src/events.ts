/**
 * Events: the ordered list of what happened during one accepted intent. The
 * server sends them with the new view; clients animate them in order and never
 * acknowledge them. Events carry ids and numbers only, never text.
 *
 * The map is open: each rule area adds its events with declaration merging
 * (see `rules/turn.ts`):
 *
 * ```ts
 * declare module "#events.ts" {
 *   interface EventMap {
 *     RentPaid: { player: PlayerId; owner: PlayerId; field: FieldId; amount: number };
 *   }
 * }
 * ```
 */

export interface EventMap {}

export type EventType = keyof EventMap;

export type GameEvent = { [K in EventType]: { type: K } & EventMap[K] }[EventType];

export type EventOf<K extends EventType> = Extract<GameEvent, { type: K }>;
