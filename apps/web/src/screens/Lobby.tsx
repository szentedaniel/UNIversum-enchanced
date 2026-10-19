import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { roomStore } from "#stores/room-store.ts";
import { m, playerName, rejectionText } from "#text.ts";
import type { RejectionCode } from "@universum/protocol/messages";

export function Lobby() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const lobby = useStore(roomStore, (s) => (s.code === code ? s.lobby : null));
  const me = useStore(roomStore, (s) => s.me);
  const started = useStore(roomStore, (s) => s.code === code && s.push !== null);
  const [error, setError] = useState<RejectionCode | null>(null);

  useEffect(() => {
    ensureJoined(code).catch((e: unknown) =>
      setError(e instanceof JoinError ? e.code : "INTERNAL"),
    );
  }, [code]);

  useEffect(() => {
    if (started) void navigate(`/game/${code}`, { replace: true });
  }, [started, code, navigate]);

  if (error) {
    return (
      <main className="screen">
        <p role="alert" className="error">
          {rejectionText(error)}
        </p>
        <Link to="/">{m.back_home()}</Link>
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
      <h1>{m.lobby_title()}</h1>
      <p className="room-code" data-testid="room-code">
        {m.lobby_code({ code: lobby.code })}
      </p>
      <p>
        {m.lobby_players({ count: lobby.seats.length, max: maxPlayers })} ·{" "}
        {m.lobby_minute_limit({ minutes: minuteLimit })}
      </p>
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
      <Link to="/">{m.back_home()}</Link>
    </main>
  );
}
