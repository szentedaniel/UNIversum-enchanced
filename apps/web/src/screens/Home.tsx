import {
  MINUTE_LIMITS,
  PLAYER_COUNTS,
  type CreateOptions,
  type RejectionCode,
} from "@universum/protocol/messages";
import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Logo } from "#components/Logo.tsx";
import { ROOM_CODE_LENGTH as CODE_LENGTH, RoomCodeInput } from "#components/RoomCodeInput.tsx";
import { Button } from "#components/ui/button.tsx";
import { createRoom, JoinError, joinRoom, leaveRoom } from "#connection.ts";
import { m, rejectionText } from "#text.ts";

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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center gap-6 px-4 pt-10 pb-8 text-center md:pt-16">
      <Logo />
      <Button
        size="lg"
        className="w-full max-w-md"
        disabled={busy}
        onClick={() => void go(() => createRoom(settingsFrom(params)))}
      >
        <Plus size={26} strokeWidth={3} aria-hidden />
        {m.home_create()}
      </Button>
      <p className="m-0 font-bold text-muted-foreground">{m.home_or_join()}</p>
      <form
        className="sticker flex flex-wrap items-center justify-center gap-2 rounded-ui bg-card p-2 text-card-foreground"
        onSubmit={onJoin}
      >
        <RoomCodeInput value={code} onValueChange={setCode} disabled={busy} />
        <Button type="submit" variant="accent" disabled={busy || code.length !== CODE_LENGTH}>
          {m.home_join()}
        </Button>
      </form>
      {error && (
        <p
          role="alert"
          className="sticker-sm m-0 rounded-full bg-[#ffd0d0] px-4 py-1 font-bold text-ink"
        >
          {rejectionText(error)}
        </p>
      )}
    </main>
  );
}
