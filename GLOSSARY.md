# UNIversum

A Monopoly-like online board game for up to four players, set in a university world, where players gather in Rooms and play timed games on an isometric Board.

## Language

### Sessions

**Room**:
One game session that players join with a short code, from creation until the Room closes; its game can end and the Room can return to Lobby for a rematch.
_Avoid_: Game (for the session itself), match

**Lobby**:
A Room in its waiting state, before its game has started.
_Avoid_: Waiting room

**Player**:
A participant in one Room's game, standing on a Field and holding money and properties.
_Avoid_: User (for in-game participants)

**Guest**:
A Player known only by an anonymous identity tied to their browser, with no account behind it.
_Avoid_: Anonymous user

**Bot**:
A Player the game plays by itself, either seated in a Lobby in place of a Guest or standing in for a Guest who dropped out of a running game until they return; other Players always see that it is a Bot.
_Avoid_: AI, computer player, NPC

**Seat**:
A Player's place in a Room, kept for them while they are disconnected so they can rejoin.
_Avoid_: Slot

**Lobby list**:
The public list of Lobbies a Guest can join; a Room whose game has started, or whose Seats are all taken, is not on it.
_Avoid_: Room list, server browser

**Room code**:
The short number a Guest uses to find and join a Room.
_Avoid_: Lobby code, PIN

**Invite link**:
The Room's address `/room/<Room code>`, which joins the Room in one click and is shown with a QR code in the Lobby.
_Avoid_: Share code, join URL

**Room name**:
The name the creator gives a Room, shown on the Lobby list; the only text a Guest types that other Guests see.
_Avoid_: Lobby name, title

**Player name**:
The name other Players see for a Player, made up by the game when the Player takes a Seat; Guests do not choose or change it.
_Avoid_: Username, nickname

**Podium**:
The state of a Room whose game has ended, in which the final standings are shown and the Players can vote on a rematch.
_Avoid_: Results screen, game-over screen

**Rematch vote**:
A Player's agreement, given on the Podium and withdrawable until the Room returns to Lobby, to play again in the same Room; it lives in the Room's memory and names the Player, not the connection, so it survives a reconnect. A Bot cannot vote.
_Avoid_: Replay request, play again

**Rematch**:
The return of an ended Room to Lobby once every Player with a live connection has agreed (and at least one has), keeping the Seats that agreed and the Room's name, code, password and settings; the other Seats are released.
_Avoid_: Replay, restart

**Rematch window**:
The fixed 30 s that opens with the first Rematch vote on a Podium and never restarts on later votes; when it ends with at least one vote still cast, the Room returns to Lobby as for a Rematch, so a Player who ignores the Podium does not block the others. It lives in the Room's memory and is dropped when the votes empty or the Room returns.

### Play

**Turn**:
One Player's go, from their roll (or Quarantine choice) until play passes to the next Player.
_Avoid_: Move, round

**Roll**:
The two dice a Player throws to start their Turn (or to try to leave Quarantine); their total is how many Fields the Player moves.
_Avoid_: Throw, dobás

**Decision**:
One choice the game waits for from the current Player: a Roll, an Offer, a Quarantine choice, a Sale, or a Doubler or Erasmus pick; each has its own Turn timer.
_Avoid_: Prompt, action

**Offer**:
The Decision on landing on a Field the Player may buy or build on: buy a Level, buy the Museum, make a Buyout, or decline.
_Avoid_: Purchase prompt

**Playback**:
The showing, in order and on every screen, of everything one Player's action set off, each effect appearing on the Board and the Player cards at its own moment; the next decision, and its Turn timer, starts only once the Playback ends.
_Avoid_: Animation, replay

**Reveal**:
One event's snapshot of the Players, the Fields and the Doubler, with the numbers the screen shows, so the Board and the Player cards show the effect of the current Playback step; the engine records one beside every event and the client shows the latest step's.
_Avoid_: Delta, patch

**Decision gate**:
The moment the next decision opens, once the Playback before it has ended; the decision's controls and its Turn timer start there.
_Avoid_: Playback over, unlock

**Hint**:
A short, one-time note beside a concept a first-time Guest meets — an Offer, Quarantine, the Doubler or Erasmus pick, a Sale, or the game end — with a dismiss button; it never blocks the Decision, and the browser remembers the ones the Guest dismissed.
_Avoid_: Tooltip, tutorial, tip

**Event log**:
The list, on the Game screen, of the lines of the events the Playback has revealed so far, newest last, each line in the language active when it appeared; the client keeps it, so a reload starts it empty.
_Avoid_: History, chat, transcript

**Cue**:
A short sound effect one Game event's Playback step starts; the cue table maps each event type to at most one cue, and each cue is one audio file.
_Avoid_: Sound effect (for the named entry), clip

**Quick chat**:
The only way Players talk in a Room: each picks a ready-made line or emote from a fixed catalogue, and the server shows it beside that Player's Seat; no free text is ever sent, and it is not the Event log.
_Avoid_: Chat message, free chat

**Turn timer**:
The countdown a Player has for one decision of their Turn, starting when the Playback before it ends.
_Avoid_: Turn countdown

**Timeout penalty**:
The fine a Player pays when their Turn timer runs out.
_Avoid_: Punishment

**Room settings**:
The choices a Room's creator makes when creating it, each from a fixed list: how many Seats, the Minute limit, the starting cash, the Round bonus and the Turn timer's length.
_Avoid_: House rules, game options

**Minute limit**:
The length of a Room's game, chosen when the Room is created; it is checked at each Turn change, so the game ends after the Turn in progress.
_Avoid_: Game clock, end time

### Board

**Board**:
The playing surface of a game: an ordered ring of Fields.
_Avoid_: Map, table

**Field**:
One square on the Board; every player stands on exactly one Field.
_Avoid_: Tile, square, cell

**University**:
A Field a Player can buy and build up through Levels; each belongs to one Group.
_Avoid_: Normal Field, City, Property, Lot

**Museum**:
A Field a Player can buy but not build on, whose Rent grows with the number of Museums its owner holds.

**Level**:
How far a University is built up, from unbuilt to fully built.
_Avoid_: Floor, House, emelet

**Group**:
The Universities that belong together on the Board.
_Avoid_: Set, colour group

**Monopoly**:
One Player owning every University of a Group.

**Super-monopoly**:
One Player owning every Museum, which wins the game.

**Chance card**:
A card drawn on landing on a Chance Field, which gives or takes money, moves money between the Player and every other Player, moves the Player to Start or into Quarantine, or grants a PCR test.
_Avoid_: Esély, card

**Quarantine**:
The state of a Player who landed on the Quarantine Field and must sit out Turns until released.
_Avoid_: Jail

**Quarantine round**:
One of the Turns a Player spends in Quarantine; each failed attempt to leave uses one up.

**PCR test**:
A pass that releases a Player from Quarantine at once, either held from a Chance card or bought on the spot.

**Doubler**:
The single token on the Board that multiplies the Rent of the Field it stands on, placed by landing on the Doubler Field.
_Avoid_: Talár, Gown

**Erasmus**:
The corner Field that lets a Player travel to a University or Museum of their choice that no other Player owns.

**Round bonus**:
The money a Player receives from the Bank for passing or landing on Start.
_Avoid_: Salary, Start money

### Money

**Bank**:
The game itself, as the other side of every payment that does not go to a Player.

**Value**:
What a Field is worth at its current Level: the total of what its Levels cost.
_Avoid_: toBuy, price

**Rent**:
What a Player pays the owner on landing on a Field another Player owns.
_Avoid_: Tuition, Tandíj

**Deal**:
An exchange of Fields and cash between two Players that one proposes before their Roll or Quarantine choice, once per Turn, and the other accepts or declines; Fields change hands at their current Level, and neither side's cash may fall short.
_Avoid_: Trade, Offer (an Offer is the Decision to buy)

**Buyout**:
Buying another Player's University from them at its current Level.
_Avoid_: Takeover

**Tax**:
The Charge paid to the Bank on landing on the Tax Field, a share of the Value of the Player's Fields.
_Avoid_: Adó

**Charge**:
An amount a Player owes at once: Rent, Tax, a Chance card or a Timeout penalty.

**Shortfall**:
The part of a Charge that the Player's cash cannot cover.

**Sale**:
Selling Fields back to the Bank to cover a Shortfall; there is no other way to sell a Field.
_Avoid_: Forced sale, Liquidation

**Auto-sell**:
A Sale the game makes on the Player's behalf, cheapest Fields first.

**Bankrupt**:
A Player who is out of the game because their cash and Fields together could not cover a Charge.
_Avoid_: Eliminated, Csőd

**Wealth**:
A Player's cash plus the Value of their Fields; it decides the winner when the Minute limit runs out.

**Wealth series**:
Every Player's Wealth, sampled with the game's elapsed Minute each time a Turn passes and once more when the game ends, so the last sample equals the final standings.

**Summary**:
The end-of-game figures counted while the game runs: the biggest Rent paid, the Fields each Player bought, the Monopolies formed and the Bankruptcies, in order. A Monopoly counts each time a purchase or an accepted Deal completes it, so a Group lost and completed again counts twice.
_Avoid_: Statistics, Recap
