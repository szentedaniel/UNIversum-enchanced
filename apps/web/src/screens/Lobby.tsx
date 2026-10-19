import type { RejectionCode } from "@universum/protocol/messages";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { PasswordForm, RejectionText, useJoin } from "#screens/join.tsx";
import { roomStore } from "#stores/room-store.ts";
import { m, playerName, rejectionText, roomNameText } from "#text.ts";

export function Lobby() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const lobby = useStore(roomStore, (s) => (s.code === code ? s.lobby : null));
  const me = useStore(roomStore, (s) => s.me);
  const started = useStore(roomStore, (s) => s.code === code && s.push !== null);
  const [error, setError] = useState<RejectionCode | null>(null);
  const passwordJoin = useJoin();
  const { ask } = passwordJoin;

  // Opened by its address: join, and ask for the password if the Room has one.
  useEffect(() => {
    ensureJoined(code).catch((e: unknown) => {
      const rejection = e instanceof JoinError ? e.code : "INTERNAL";
      if (rejection === "WRONG_PASSWORD") ask(code);
      else setError(rejection);
    });
  }, [code, ask]);

  useEffect(() => {
    if (started) void navigate(`/game/${code}`, { replace: true });
  }, [started, code, navigate]);

  if (error) {
    return (
      <main className="screen">
        <p role="alert" className="error">
          {rejectionText(error)}
        </p>
        <Link to="/rooms">{m.back_to_list()}</Link>
      </main>
    );
  }

  if (!lobby && passwordJoin.asking) {
    return (
      <main className="screen">
        <h1>{m.lobby_title()}</h1>
        <PasswordForm
          busy={passwordJoin.busy}
          onSubmit={(pw) => void passwordJoin.join(code, pw)}
        />
        {passwordJoin.error && <RejectionText code={passwordJoin.error} />}
        <Link to="/rooms">{m.back_to_list()}</Link>
      </main>
    );
  }

  if (!lobby) {
    return (
      <main className="screen">
        <p>{m.connecting()}</p>
      </main>
    );
  }

  const { maxPlayers, minuteLimit } = lobby.settings;
  const full = lobby.seats.length === maxPlayers;
  const open = Array.from({ length: maxPlayers - lobby.seats.length }, (_, i) => i);

  return (
    <main className="screen lobby">
      <h1>{roomNameText(lobby.roomName, lobby.code)}</h1>
      <p className="room-code" data-testid="room-code">
        {m.lobby_code({ code: lobby.code })}
      </p>
      <ul className="settings">
        <li>{m.lobby_players({ count: lobby.seats.length, max: maxPlayers })}</li>
        <li>{m.lobby_minute_limit({ minutes: minuteLimit })}</li>
        <li>{lobby.hasPassword ? m.lobby_has_password() : m.lobby_no_password()}</li>
      </ul>
      <ul className="seats">
        {lobby.seats.map((seat, i) => (
          <li key={seat.playerId} className={`seat seat-${i}`}>
            {playerName(seat.name)}
            {seat.playerId === me && <span className="you"> ({m.lobby_you()})</span>}
          </li>
        ))}
        {open.map((i) => (
          <li key={`open-${i}`} className="seat open">
            {m.lobby_open_seat()}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="primary"
        disabled={!full}
        onClick={() => sendIntent({ type: "Start" })}
      >
        {m.lobby_start()}
      </button>
      {!full && <p className="hint">{m.lobby_waiting()}</p>}
      <Link to="/rooms">{m.back_to_list()}</Link>
    </main>
  );
}
