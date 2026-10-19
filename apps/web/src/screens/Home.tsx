import {
  MINUTE_LIMITS,
  PLAYER_COUNTS,
  type CreateOptions,
  type RejectionCode,
} from "@universum/protocol/messages";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createRoom, JoinError, joinRoom, leaveRoom } from "#connection.ts";
import { m, rejectionText } from "#text.ts";

const CODE_LENGTH = 6;

/**
 * Create settings from the address (`/?players=2&minutes=15`). Until the
 * create form lands (#36) this is how a smaller Room is made; anything not
 * on the allowed lists falls back to the defaults.
 */
function settingsFrom(params: URLSearchParams): CreateOptions {
  const maxPlayers = PLAYER_COUNTS.find((n) => n === Number(params.get("players")));
  const minuteLimit = MINUTE_LIMITS.find((n) => n === Number(params.get("minutes")));
  return { ...(maxPlayers && { maxPlayers }), ...(minuteLimit && { minuteLimit }) };
}

export function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RejectionCode | null>(null);

  // Coming home leaves any Room (its Lobby Seat is freed).
  useEffect(() => {
    void leaveRoom();
  }, []);

  async function go(connect: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const joined = await connect();
      await navigate(`/room/${joined}`);
    } catch (e) {
      setError(e instanceof JoinError ? e.code : "INTERNAL");
      setBusy(false);
    }
  }

  function onJoin(event: FormEvent) {
    event.preventDefault();
    if (code.length === CODE_LENGTH) void go(() => joinRoom(code));
  }

  return (
    <main className="screen home">
      <h1 className="logo">{m.logo()}</h1>
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void go(() => createRoom(settingsFrom(params)))}
      >
        {m.home_create()}
      </button>
      <p>{m.home_or_join()}</p>
      <form className="join" onSubmit={onJoin}>
        <label>
          {m.home_code_label()}
          <input
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          />
        </label>
        <button type="submit" disabled={busy || code.length !== CODE_LENGTH}>
          {m.home_join()}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {rejectionText(error)}
        </p>
      )}
    </main>
  );
}
