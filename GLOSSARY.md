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

### Board

**Board**:
The playing surface of a game: an ordered ring of Fields.
_Avoid_: Map, table

**Field**:
One square on the Board; every player stands on exactly one Field.
_Avoid_: Tile, square, cell
