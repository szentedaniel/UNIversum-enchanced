# UNIversum

A Monopoly-like online board game for up to four players, set in a university world, where players gather in Rooms and play timed games on an isometric Board.

## Language

### Sessions

**Room**:
One game session that players join with a short code, from creation until the game ends.
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

**Seat**:
A Player's place in a Room, kept for them while they are disconnected so they can rejoin.
_Avoid_: Slot

**Lobby list**:
The public list of Lobbies a Guest can join; Rooms whose game has started are not on it.
_Avoid_: Room list, server browser

**Room code**:
The short number a Guest uses to find and join a Room.
_Avoid_: Lobby code, PIN

**Room name**:
The name the creator gives a Room, shown on the Lobby list; the only text a Guest types that other Guests see.
_Avoid_: Lobby name, title

**Player name**:
The name other Players see for a Player, made up by the game when the Player takes a Seat; Guests do not choose or change it.
_Avoid_: Username, nickname

### Play

**Turn**:
One Player's go, from their roll (or Quarantine choice) until play passes to the next Player.
_Avoid_: Move, round

**Roll**:
The two dice a Player throws to start their Turn (or to try to leave Quarantine); their total is how many Fields the Player moves.
_Avoid_: Throw, dobás

**Playback**:
The showing, in order and on every screen, of everything one Player's action set off; the next decision, and its Turn timer, starts only once the Playback ends.
_Avoid_: Animation, replay

**Decision gate**:
The moment the next decision opens, once the Playback before it has ended; the decision's controls and its Turn timer start there.
_Avoid_: Playback over, unlock

**Turn timer**:
The countdown a Player has for one decision of their Turn, starting when the Playback before it ends.
_Avoid_: Turn countdown

**Timeout penalty**:
The fine a Player pays when their Turn timer runs out.
_Avoid_: Punishment

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
A card drawn on landing on a Chance Field, which gives or takes money or grants a PCR test.
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
