import {
  DEFAULT_SETTINGS,
  MINUTE_LIMITS,
  PASSWORD_MAX_BYTES,
  PLAYER_COUNTS,
  utf8Length,
  type RejectionCode,
  type RoomSettings,
} from "@universum/protocol/messages";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { createRoom, JoinError, leaveRoom } from "#connection.ts";
import { RejectionText } from "#screens/join.tsx";
import { m } from "#text.ts";

/** `/create`: the Room's settings, fixed from here on (R1, R3, R11). */
export function CreateRoom() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<RoomSettings["maxPlayers"]>(
    DEFAULT_SETTINGS.maxPlayers,
  );
  const [minuteLimit, setMinuteLimit] = useState<RoomSettings["minuteLimit"]>(
    DEFAULT_SETTINGS.minuteLimit,
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RejectionCode | null>(null);
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;

  useEffect(() => {
    void leaveRoom();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tooLong) return;
    setBusy(true);
    setError(null);
    try {
      const code = await createRoom({
        roomName,
        maxPlayers,
        minuteLimit,
        ...(password && { password }),
      });
      await navigate(`/room/${code}`);
    } catch (e) {
      setError(e instanceof JoinError ? e.code : "INTERNAL");
      setBusy(false);
    }
  }

  return (
    <main className="screen create">
      <h1>{m.create_title()}</h1>
      <form className="create-form" onSubmit={(e) => void submit(e)}>
        <label>
          {m.create_room_name()}
          <input
            value={roomName}
            maxLength={64}
            autoComplete="off"
            aria-describedby="room-name-hint"
            onChange={(e) => setRoomName(e.target.value)}
          />
        </label>
        <p id="room-name-hint" className="hint">
          {m.create_room_name_hint()}
        </p>
        <fieldset>
          <legend>{m.create_players()}</legend>
          {PLAYER_COUNTS.map((count) => (
            <label key={count}>
              <input
                type="radio"
                name="players"
                checked={maxPlayers === count}
                onChange={() => setMaxPlayers(count)}
              />
              {count}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{m.create_minute_limit()}</legend>
          {MINUTE_LIMITS.map((minutes) => (
            <label key={minutes}>
              <input
                type="radio"
                name="minutes"
                checked={minuteLimit === minutes}
                onChange={() => setMinuteLimit(minutes)}
              />
              {m.lobby_minute_limit({ minutes })}
            </label>
          ))}
        </fieldset>
        <label>
          {m.create_password()}
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {tooLong && (
          <p role="alert" className="error">
            {m.password_too_long()}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || tooLong}>
          {m.home_create()}
        </button>
        {error && <RejectionText code={error} />}
      </form>
      <Link to="/rooms">{m.back_to_list()}</Link>
    </main>
  );
}
