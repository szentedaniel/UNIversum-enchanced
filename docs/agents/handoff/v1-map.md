# v1 code map (main @ 5c8d359; moves to `v1/client`, `v1/server` in #23)

All paths below are on `main` today. After #23's `git mv`, prefix them with `v1/` (e.g. `v1/client/src/gameConfig.js`).
Read any file with `git show main:<path>`. The full rule catalogue with `file:line` citations is
`docs/research/rules-inventory-v1.md` (R1–R80, flags F1–F30) — use it instead of re-reading the reducers.

## Layout

| What                                                            | Path                                                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes (`/`, `/rooms`, `/create`, `/room/:code`, `/game/:code`) | `client/src/Components/App.jsx` (react-router-dom `BrowserRouter`)                                                                                               |
| Pages                                                           | `client/src/Pages/{Home,Rooms,Create,Room,Game}.jsx`                                                                                                             |
| ALL rule reducers (Redux slice)                                 | `client/src/Store/slices/gameStateSlice.js` (~1300 lines; client-side initial Board state at ~425-650)                                                           |
| Prices / Rent / sale values                                     | `client/src/Utils/calcPrice.js`                                                                                                                                  |
| Board layout, Field list, Chance cards                          | `client/src/gameConfig.js` (`GAME_CONFIG.map` 32 entries, `GAME_CONFIG.cards` 3 entries, geometry consts)                                                        |
| Group / Player colours, languages                               | `client/src/config.js` (`GROUP_COLORS`, `PLAYER_COLORS`, `LANGUAGES`, `COLOR_THEMES`)                                                                            |
| Isometric placement                                             | `client/src/Utils/calcCoords.js` (ported verbatim in `prototype/*:prototypes/board-phone/src/board/data.ts` `calcCoords`)                                        |
| Money format                                                    | `client/src/Utils/formatter.js` (`Intl.NumberFormat('hu-HU', {style:'currency', currency:'HUF', minimumFractionDigits:0})`)                                      |
| Random Player names (hu + en word lists, no de)                 | `client/src/randomName.js` (65 KB; `en_name1/en_name2/hu_name1/hu_name2` adjective+noun arrays; off-by-one bug: `getRandomInt(0, len+1)` can index past the end) |
| Board renderer (react-pixi / PIXI v6-era)                       | `client/src/Components/GameComponentNew.jsx` + `client/src/Components/GameComponents/*.jsx`                                                                      |
| Server (socket.io relay)                                        | `server/index.ts`, `server/roomSystem.ts`, `server/GameSystem/GameSystem.ts`, `server/GameSystem/initialState.ts`, `server/types/*.ts`                           |
| Room code                                                       | `server/utils/generateRoomCode.ts`: `Math.floor(Math.random()*900000+100000)` → 100000–999999, re-rolled while in use                                            |
| Server error text                                               | `server/config/messages.js` (`402 Password is incorrect.`, `403 The room is full.`, `404 The room is not exists.`, `503`)                                        |
| Tracked `.env`                                                  | `server/.env` — contains only `PORT=…` (no credential; nothing to rotate)                                                                                        |

Server Room state per Room (`roomSystem.ts`): name (default `Lobby <code>`), bcrypt password hash, max Players, minutes, users list. Game state on server is only the initial deal (`GameSystem.ts`); browsers run the rules.

## Board data (from `client/src/gameConfig.js` `GAME_CONFIG.map`)

`name` = internal key, `label` = drawn text (Hungarian/lowercase as in v1). n = University ordinal; base price B = 200,000 + (n−1)×20,000 (`calcPrice.js`: `correctId` counts only `isNormal` Fields).
Values by Level: L1 1.0B, L2 1.2B, L3 1.6B, L4 2.2B (from `buyScale` 0.2/0.2/0.3/0.4). Rent = Value × 0.55/0.70/0.85/1.00, ×1.4 Monopoly. Sale 90%, Buyout 200%. Museum 400,000, Rent 75,000 × museums owned, sale 360,000.

| id  | name         | label        | kind       | groupId                       | flip  | zIndex | n   | B      |
| --- | ------------ | ------------ | ---------- | ----------------------------- | ----- | ------ | --- | ------ |
| 0   | start        | start        | start      | 0                             | false | -2     |     |        |
| 1   | veszprem     | veszprém     | university | 1                             | false | -4     | 1   | 200000 |
| 2   | budapest     | budapest     | university | 1                             | false | -6     | 2   | 220000 |
| 3   | debrecen     | debrecen     | university | 1                             | false | -8     | 3   | 240000 |
| 4   | museum       | museum       | museum     | 0                             | false | -10    |     |        |
| 5   | zurich       | Zürich       | university | 2                             | false | -12    | 4   | 260000 |
| 6   | paris        | Paris        | university | 2                             | false | -14    | 5   | 280000 |
| 7   | edinburgh    | edinburgh    | university | 2                             | false | -16    | 6   | 300000 |
| 8   | karanten     | Karantén     | quarantine | **2** (bug F1: v2 → no Group) | false | -18    |     |        |
| 9   | chicago      | chicago      | university | 3                             | true  | -20    | 7   | 320000 |
| 10  | austin       | austin       | university | 3                             | true  | -22    | 8   | 340000 |
| 11  | princeton    | princeton    | university | 3                             | true  | -24    | 9   | 360000 |
| 12  | museum       | museum       | museum     | 0                             | true  | -26    |     |        |
| 13  | vienna       | vienna       | university | 4                             | true  | -28    | 10  | 380000 |
| 14  | esély        | esély        | chance     | 0                             | true  | -30    |     |        |
| 15  | berlin       | berlin       | university | 4                             | true  | -32    | 11  | 400000 |
| 16  | doubler      | Talár        | doubler    | 0                             | false | -34    |     |        |
| 17  | seattle      | seattle      | university | 5                             | false | -32    | 12  | 420000 |
| 18  | esély        | esély        | chance     | 0                             | false | -30    |     |        |
| 19  | new haven    | new haven    | university | 5                             | false | -28    | 13  | 440000 |
| 20  | museum       | museum       | museum     | 0                             | false | -26    |     |        |
| 21  | london       | london       | university | 6                             | false | -24    | 14  | 460000 |
| 22  | oxford       | oxford       | university | 6                             | false | -22    | 15  | 480000 |
| 23  | cambridge uk | cambridge uk | university | 6                             | false | -20    | 16  | 500000 |
| 24  | erasmus      | Erasmus      | erasmus    | 0                             | false | -18    |     |        |
| 25  | esély        | esély        | chance     | 0                             | true  | -16    |     |        |
| 26  | berkeley     | berkeley     | university | 7                             | true  | -14    | 17  | 520000 |
| 27  | new york     | new york     | university | 7                             | true  | -12    | 18  | 540000 |
| 28  | museum       | museum       | museum     | 0                             | true  | -10    |     |        |
| 29  | stanford     | stanford     | university | 8                             | true  | -8     | 19  | 560000 |
| 30  | adó          | adó          | tax        | 0                             | true  | -6     |     |        |
| 31  | cambridge us | cambridge us | university | 8                             | true  | -4     | 20  | 580000 |

Groups: 1={1,2,3}, 2={5,6,7}, 3={9,10,11}, 4={13,15}, 5={17,19}, 6={21,22,23}, 7={26,27}, 8={29,31}. Corners 0/8/16/24.
Geometry consts (`GAME_CONFIG`): `scale 0.65, main_container_scale_y 1.1, PIECE_HEIGHT 48, PIECE_BOTTOM_HEIGHT 32, PIECE_WIDTH 64.5, SPACE_X 5, SPACE_Y 2.5`.

Group colours (`config.js` `GROUP_COLORS`): 1 `0x915537`, 2 `0xADDEFE`, 3 `0xD43B90`, 4 `0xF49424`, 5 `0xEA1C25`, 6 `0xFBF204`, 7 `0x1DB458`, 8 `0x0572BB`.
Player colours (`PLAYER_COLORS`): 0 `0xF29DB6` pink, 1 `0x8DB5E7` blue, 2 `0x70C4A8` green, 3 `0xFFCC00` yellow.
Theme (`client/tailwind.config.js` `sajat`): 100 `#ffbb6c` … 300 `#d4896a`, 500 `#9f6c66`, 700 `#503c52`, 800 `#3b2f44`, 900 `#262335`.

## Chance cards (`GAME_CONFIG.cards`, Hungarian only)

| id  | effect                        | title                    | desc                                                                                          |
| --- | ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| 0   | `PCR: true` (gain a PCR test) | Negatív PCR teszt        | Nyertél egy negatív PCR tesztet amit legközelebb felhasználhatsz, ha karanténba jutsz.        |
| 1   | `moneyValue: 200_000`         | Nyeremény                | Olyan jó átlagod lett, hogy 200 000 ft ösztöndíjban részesülsz.                               |
| 2   | `moneyValue: -200_000`        | Minden tárgyól megbuktál | Sajnos minden tárgyadból megbuktál így 200 000 ft-ot kell fizetned, hogy újra felvehesd őket. |

(Typo "tárgyól" is v1's; v2 message files should clean it to "tárgyból".)

## Hungarian / UI strings — where they live

v1 i18n is react-i18next + http backend (`client/src/i18n.js`, `fallbackLng: 'hu'`). Almost nothing in-game uses it.

| Source                                                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/public/assets/i18n/translations/hu.json`, `en.json`     | 9 keys (username, language_selector, not_in_lobby, create_lobby, join_lobby, show_lobbies, or, …). No de.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `client/src/Components/CreateLobbyComponent/i18n/{hu,en,de}.js` | CREATE_LOBBY, ROOM_NAME, PLAYERS, TIME, PASSWORD, PLACEHOLDER_ROOM, MIN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `client/src/Components/LobbyComponent/i18n/{hu,en,de}.js`       | username, not_in_lobby, create_lobby, join_lobby, show_lobbies, PLAY_NOW …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `client/src/gameConfig.js`                                      | Field labels (`Karantén`, `Talár`, `esély`, `adó`, city names) + Chance card title/desc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Hard-coded hu JSX                                               | `GameComponents/BuyComponent.jsx` (Város, Vásárlás, Tandíj, "Ráléptél az ADÓ mezőre", "Fizetned kell … összeget", Megértettem, "Más játékos interakciót végez éppen...", "Más játkosok ennyiért vehetik meg tőled:", museum Rent hint), `InQuarantine.jsx` (karantén, "Karanténban vagy még N körig. Válassz az opciók közül:" + option buttons ~l.130-140), `Quarantine.jsx` ("Jaj ne! Sajnos túl sokat jártál be előadásra és elkaptad a COVID-19 vírust.", "3 körből kimaradsz."), `OnDoubler.jsx` ("Lediplomáztál.", "Jutalmul válassz ki egy várost, ahol ezentúl a tandíj MEGDUPLÁZÓDIK.", "Válassz egy mezőt"), `OnErasmus.jsx` ("Erasmusra mész.", "Válassz ki egy várost, ahova szeretnél menni."), `Sell.jsx` ("Válaszd ki a mezőket" + Sell button), `Winner.jsx` (GYŐZELEM, "Gratulálunk!!!", Csodás), `PlayerInfo.jsx` (CSŐD), `ChanceCard.jsx` (Megértettem), `LobbiesList.jsx` (Szobák, össz:, "Játékosok a szobában"), `LangSelector.jsx` (Mentés), `Pages/Room.jsx`, `CountdownBoard.jsx`, `RollDice.jsx` |

Quick extraction: `git grep -n -P "[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]" main -- 'client/src/**/*.jsx' client/src/gameConfig.js` (also check strings without diacritics in the same files). Ignore comments/console.log lines.

## Images actually used by the code (the "~35")

Two loading styles: (a) `Texture.from('../Images/game/…')` / `<img src="../../Images/…">` / CSS `url(../Images/…)` are **runtime URLs** resolving to `/Images/game/…` → served from `client/public/images/game/…` (note case: code says `Images`, folder is `images`; worked only on a case-insensitive FS). (b) ES `import x from '../../Images/…'` → bundled from `client/src/Images/…`.
Prototype short names (in `prototype/*:prototypes/board-phone/public/board/<name>.png`, byte-identical copies) in brackets.

### Board (PixiJS, runtime, from `client/public/images/game/`)

| #     | Path                                                                                              | Used in                                                                                                                        | proto name    |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1     | `client/public/images/game/isometriccity/PNG/cityTiles_072.png`                                   | label tile under Field names (recoloured to Group colour by ColorReplace 0xc2beac) — Normal/Corner(Start edge)/Luck/Museum/Tax | `label_bg`    |
| 2     | `client/public/images/game/isometriclandscape/PNG/landscapeTiles_067.png`                         | ground tile (Normal/Luck/Tax)                                                                                                  | `ground`      |
| 3     | `client/public/images/game/isometriclandscape/PNG/landscapeTiles_081_1.png`                       | corner road                                                                                                                    | `road`        |
| 4     | `client/public/images/game/isometriclandscape/PNG/landscapeTiles_087.png`                         | Start corner left road                                                                                                         | `road_left`   |
| 5     | `client/public/images/game/isometriclandscape/PNG/landscapeTiles_080.png`                         | Start corner right road                                                                                                        | `road_right`  |
| 6     | `client/public/images/game/isometriclandscape/PNG/landscapeTiles_114.png`                         | Start corner top road                                                                                                          | `road_top`    |
| 7     | `client/public/images/game/characters/haz_alap.png`                                               | house base (Building.jsx; recolour 0x8ab549 → owner)                                                                           | `haz_alap`    |
| 8     | `client/public/images/game/characters/haz_resz.png`                                               | house storey                                                                                                                   | `haz_resz`    |
| 9     | `client/public/images/game/characters/haz_teto.png`                                               | house roof                                                                                                                     | `haz_teto`    |
| 10    | `client/public/images/game/characters/museum.png`                                                 | Museum building                                                                                                                | `museum`      |
| 11    | `client/public/images/game/characters/doubler.png`                                                | Doubler token on a Field (Normal/Museum)                                                                                       | `doubler`     |
| 12    | `client/public/images/game/characters/karibacsik.png`                                             | Quarantine corner                                                                                                              | `karibacsik`  |
| 13    | `client/public/images/game/characters/erasmus.png`                                                | Erasmus corner (plane)                                                                                                         | `erasmus`     |
| 14    | `client/public/images/game/characters/diploma.png`                                                | Doubler corner                                                                                                                 | `diploma`     |
| 15    | `client/public/images/game/characters/tabla.png`                                                  | Start corner sign                                                                                                              | `tabla`       |
| 16    | `client/public/images/game/characters/chest_E.png`                                                | Chance chest (flipped Fields)                                                                                                  | `chest_E`     |
| 17    | `client/public/images/game/characters/chest_N.png`                                                | Chance chest                                                                                                                   | `chest_N`     |
| 18    | `client/public/images/game/characters/ado2.png`                                                   | Tax Field                                                                                                                      | `ado2`        |
| 19    | `client/public/images/game/characters/board.png`                                                  | CountdownBoard.jsx (Minute-limit sign)                                                                                         | —             |
| 20–23 | `client/public/images/game/moreenemiesanimations/Alien sprites/alien{Pink,Blue,Green,Yellow}.png` | pawns (Character.jsx; colourCode 0..3)                                                                                         | `alienPink` … |

### DOM (bundled imports from `client/src/Images/game/`)

| #     | Path                                                                                                                              | Used in                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 24–27 | `client/src/Images/game/moreenemiesanimations/Alien sprites/alien{Pink,Blue,Green,Yellow}.png` (identical bytes to public copies) | PlayerInfo.jsx, Winner.jsx avatars    |
| 28    | `client/src/Images/game/characters/museum.png` (**differs** from public copy)                                                     | BuyComponent.jsx museum modal         |
| 29    | `client/src/Images/game/characters/ado2.png` (= public)                                                                           | BuyComponent.jsx Tax modal            |
| 30    | `client/src/Images/game/characters/diploma.png` (**differs** from public copy)                                                    | OnDoubler.jsx                         |
| 31    | `client/src/Images/game/characters/erasmus.png` (= public)                                                                        | OnErasmus.jsx                         |
| 32    | `client/src/Images/game/emojis/trophy.png`                                                                                        | ChanceCard.jsx                        |
| 33    | `client/src/Images/game/emojis/biohazard.png`                                                                                     | Quarantine.jsx, InQuarantine.jsx      |
| 34    | `client/src/Images/game/gameicons/PNG/White/1x/checkmark.png`                                                                     | BuyComponent.jsx (affordable Level)   |
| 35    | `client/src/Images/game/gameicons/PNG/White/1x/locked.png`                                                                        | BuyComponent.jsx (unaffordable Level) |
| 36    | `client/src/Images/game/dice/dice_detailed.png`                                                                                   | RollDice.jsx roll button              |

### DOM (runtime URLs from `client/public/images/game/`)

| #     | Path                                                                             | Used in                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 37–42 | `client/public/images/game/dice/dice_{1..6}.png`                                 | Dice.jsx `src={\`../../Images/game/dice/dice_${face}.png\`}`                                                                                                                                                      |
| 43–50 | `client/public/images/game/background-elements-redux-fix/Backgrounds/{1..8}.png` | Pages/Game.jsx random backdrop `url(../Images/game/background-elements-redux-fix/Backgrounds/${bg}.png)`, bg = 1..8 (blurred). Spec's Tabletop backdrop is a CSS radial gradient, so these are likely not needed. |

Everything else under `client/public/images/game/` (Kenney packs, survival-kit, monopolyums, caracters/ duplicates) and `client/src/Images/game/*.zip` is unused.

Minimal set for v2 Board (= the prototype's 22 files): #1–18 + 4 aliens; plus `board.png` only if the Minute sign is kept; DOM extras: dice faces 1–6, dice_detailed, trophy, biohazard (spec may replace with icons).

## Logo

- `client/src/Images/logos/monopoly_logo.png` (113,952 B) is imported in `client/src/Components/Logo.jsx` **but the `<img>` is commented out**; the visible v1 logo is the text "UNIversum" (`<p className='text-5xl text-sajat-100'>`, font Sigmar One from Google Fonts in `client/public/index.html`). The Tabletop prototype's `Logo` is also text (Sigmar One, primary colour, 2 px `-webkit-text-stroke` + `4px 4px 0` shadow): `git show prototype/ui-direction:prototypes/board-phone/src/ui/dirB.tsx` (`const Logo`).
- Favicon: `client/public/favicon.ico`.

## Dice sound

- `client/src/Sounds/dice-sound.mp3` (12,120 B). Played via `use-sound` in `client/src/Components/GameComponents/RollDice.jsx:4-5,27-28,75`.
