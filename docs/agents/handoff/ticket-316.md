# Ticket #316 (Web: the Field card shows Level Rents, Group ownership, base price and Doubler) — facts for later tickets

Branch `agent/issue-316-web-field-card-shows-level-rents-group-ownership-b`. Reads the view keys #315 added; the hover tooltip (#318) reads the same `fieldFacts`.

## `apps/web/src/board/field-facts.ts`

- `FieldFacts` gained five keys, all read from the pushed view or `FIELDS` (no rule arithmetic):
  - `levelRents: number[]` — the view's table (`FieldView.levelRents`), empty for anything without Levels. Non-zero while the Field is unowned (the rules' table is what the card shows, `rent` stays 0/null).
  - `group: GroupMember[] | null` — every Field with the same `FIELDS` Group in Board order, each `{ field, owner }` with the owner looked up in `view.players`; `null` for a Museum, Chance, Tax and every corner (`FieldInfo.group` is `null`).
  - `monopoly: boolean` — true only when the Group's first member has an owner and every member has that same owner id, mirroring `isMonopoly`; false for a Group with an unowned Field and for anything without a Group.
  - `basePrice: number | null` — the view's `basePrice` while the Field is ownable and unowned, else `null` (owned, or a Field nobody can own).
  - `doublers: number` — the view's `doublers` (0 when none).
- `level` (already there) is the Level to highlight: `levelRents[i]` is Level `i + 1`, so the card marks the cell where `i + 1 === level`. Level 0 highlights nothing.
- `GroupMember` is exported from the module; the card takes `member.field.key` to `fieldName` and `member.owner` for the token.
- `fieldFacts` is still the only mapping: `Board.tsx` still reads only `rent` from it for the tile note.

## `apps/web/src/board/FieldCard.tsx`

- Only the ownable block changed. Universities get, in order: the existing Rent / Level / Value tiles, the owner line, the base price while unowned, the Level Rent table, the Group row and the Doubler badge. Museums keep the Rent / Level / Value tiles and the owner line, get the base price while unowned and the Doubler badge, and draw no Level table and no Group row.
- Test ids (read by `apps/e2e/tests/field-card.spec.ts`; keep them stable):
  - `field-card-level-rents` — the `<ul>`, `aria-label` "Rent by Level"; one `field-card-level-rent` per Level with `data-level="1".."4"`, and `aria-current="true"` on the current Level (none while unowned).
  - `field-card-base-price` — the unowned price line; absent once owned.
  - `field-card-group` — the Group box; one `field-card-group-field` per Group Field with `data-field` and `data-owner` (the Player id, `""` while unowned). An owned member also carries a `PlayerToken` (`[data-shape]`).
  - `field-card-monopoly` — the Monopoly mark inside `field-card-group`, present only on a true Monopoly.
  - `field-card-doubler` — the badge, present only while `doublers > 0`, text `field_card_doubler` (`{count}`).
- The five new messages (`field_card_level_rents`, `field_card_group`, `field_card_monopoly`, `field_card_base_price`, `field_card_doubler`) are in hu/en/de. Run `pnpm --filter @universum/web run paraglide` after touching them (`messages.test.ts` keeps parity).
- The extra rows make the card taller. The phone bottom slot caps and scrolls the card through `useCardLayout` (`lib/tray-layout.ts`); the wide bottom strip's behaviour is unchanged (it caps only while a hint sits above the card).

## E2E

- `apps/e2e/tests/field-card.spec.ts` gained `moneyOf` (the screen's en-US HUF format) and a second test: the seeded first Roll lands on Field 10 (Austin, `GAME_SEED: "4,29,55,129"`), the test buys Level 1 from the `offer`, then taps the Field with a retry wrapper (the camera refits on the Turn change) and asserts the highlighted Level cell, the four rows, the Group's three members with one token and no Monopoly mark. It ends with a made-up `showView` push whose Field has `doublers: 2`, to assert the badge's count without steering a real Doubler placement.
- The first test now also asserts the unowned University's base price and unhighlighted table, the Group row with no tokens, the Museum's missing Level table/Group row, and zero Doubler badge.
- The card opens on a tap only while no Decision is open (`fieldTap`); the new test buys first, so the offer is gone before the tap. The first-time Offer hint disappears with the offer, so it does not shift the card while tapping.

## No rules change

`packages/rules` is untouched: #315 already put the keys in `FieldView`, and the web still imports only types and `@universum/rules/board` (`import-fence.test.ts`).
