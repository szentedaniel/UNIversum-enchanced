import type { LobbyListing } from "@universum/protocol/messages";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { leaveRoom, watchLobbyList } from "#connection.ts";
import { JoinByCode, PasswordForm, RejectionText, useJoin } from "#screens/join.tsx";
import { m, roomNameText } from "#text.ts";

/** `/rooms`: every open Lobby, live; a started game leaves the list. */
export function LobbyList() {
  const [lobbies, setLobbies] = useState<LobbyListing[] | null>(null);
  const { code: tried, asking, error, busy, join, ask } = useJoin();

  // Coming back to the list leaves any Room (its Lobby Seat is freed).
  useEffect(() => {
    void leaveRoom();
  }, []);

  useEffect(() => watchLobbyList(setLobbies), []);

  return (
    <main className="screen rooms">
      <h1 className="logo">{m.logo()}</h1>
      <Link className="button primary" to="/create">
        {m.home_create()}
      </Link>
      <JoinByCode />
      <h2>{m.rooms_title()}</h2>
      {lobbies === null && <p>{m.connecting()}</p>}
      {lobbies?.length === 0 && <p className="hint">{m.rooms_empty()}</p>}
      {lobbies && lobbies.length > 0 && (
        <ul className="lobby-list">
          {lobbies.map((lobby) => {
            const full = lobby.players >= lobby.maxPlayers;
            const current = tried === lobby.code;
            return (
              <li key={lobby.code} className="lobby-tile" data-testid={`lobby-${lobby.code}`}>
                <h3>{roomNameText(lobby.roomName, lobby.code)}</h3>
                {lobby.hasPassword && (
                  <p className="lock">
                    <span aria-hidden="true">🔒 </span>
                    {m.rooms_has_password()}
                  </p>
                )}
                <p>{m.lobby_code({ code: lobby.code })}</p>
                <p>
                  {m.lobby_players({ count: lobby.players, max: lobby.maxPlayers })} ·{" "}
                  {m.lobby_minute_limit({ minutes: lobby.minuteLimit })}
                </p>
                {full ? (
                  <p className="full">{m.rooms_full()}</p>
                ) : (
                  !(current && asking) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => (lobby.hasPassword ? ask(lobby.code) : void join(lobby.code))}
                    >
                      {m.home_join()}
                    </button>
                  )
                )}
                {current && asking && !full && (
                  <PasswordForm busy={busy} onSubmit={(pw) => void join(lobby.code, pw)} />
                )}
                {current && error && <RejectionText code={error} />}
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/">{m.back_home()}</Link>
    </main>
  );
}
