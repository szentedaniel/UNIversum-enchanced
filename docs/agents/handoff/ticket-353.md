# Ticket #353 (Field card review follow-ups from #352) — facts for later tickets

Branch `agent/issue-353-factory-review-follow-ups-352`. Three follow-ups to #316, all in the Web app and its e2e; `packages/rules` and `field-facts.ts` are untouched.

## The Level label

- `apps/web/src/board/FieldCard.tsx` renders each Level Rent cell with `m.field_card_level_n({ level })`, not a concatenation of `field_card_level` and the number: hu reads `{level}. szint`, en `Level {level}`, de `Stufe {level}`. The plain `field_card_level` key stays for the Stat tile at the top of the card.
- `field_card_level_n` carries `{level}` in all three message files (`messages.test.ts` keeps key and placeholder parity); run `pnpm --filter @universum/web run paraglide` after touching them.

## The wording

- English `field_card_level_rents` is now "Level Rents", so the `field-card-level-rents` `<ul>`'s `aria-label` uses the glossary's term; hu ("Tandíj szintenként") and de ("Miete pro Stufe") are unchanged.
- `GLOSSARY.md`'s **Rent** entry no longer lists `Tandíj` under _Avoid_; it says the Hungarian UI says Tandíj, keeping glossary and messages in agreement. `messages.test.ts` still pins `field_card_rent` to the hu stem "Tandíj".

## The tests

- `apps/e2e/tests/field-card.spec.ts`'s Level-row test now asserts the current cell's `{level}` label ("Level 1") and the fourth cell's ("Level 4"). After the Level table assertions it shows one made-up `showView` push: it gives the current Player every Group Field of the tapped University and puts a Doubler (`doublers: 2`) on it, then asserts the Monopoly mark, the badge count and three Group tokens. No seeded game reaches a Monopoly or the Doubler token this early, and the ticket forbids a new `universumTest` hook for it; the spec says so in a comment.
- `apps/web/test/field-facts.test.ts` gained a `the Field card` block rendering `FieldCard` with `renderToStaticMarkup`, because the e2e can only show those two marks through the made-up push: it pins the hu "2. szint" word order, the en "Level Rents" `aria-label`, the Monopoly mark, and the Doubler badge's count. The locale comes from `overwriteGetLocale` (`#paraglide/runtime.js`) and resets to `baseLocale` in `afterEach`, as in `field-tooltip.test.ts`.
