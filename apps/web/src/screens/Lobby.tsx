import { serverNow, type RejectionCode } from "@universum/protocol/messages";
import { Check, Copy, Lock, LockOpen, Timer, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { ReconnectOverlay } from "#components/ReconnectOverlay.tsx";
import { ScreenHeader } from "#components/ScreenHeader.tsx";
import { SeatCard } from "#components/SeatCard.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { PasswordForm, RejectionText, retryAtOf, useCountdown, useJoin } from "#screens/join.tsx";
import { roomStore } from "#stores/room-store.ts";
import { m, playerName, roomNameText } from "#text.ts";

const COPIED_MS = 1500;

/** The Room code as a big sticker; one tap copies it. */
function RoomCodeSticker({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={m.lobby_copy_code()}
      data-testid="room-code"
      className="sticker press inline-flex cursor-pointer items-center gap-3 rounded-ui bg-card px-5 py-2 text-card-foreground"
      onClick={() => {
        navigator.clipboard.writeText(code).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      <span className="tnum font-display text-4xl tracking-widest md:text-5xl">{code}</span>
      {copied ? (
        <span className="inline-flex items-center gap-1 text-sm font-extrabold">
          <Check size={20} strokeWidth={3} aria-hidden />
          {m.lobby_copied()}
        </span>
      ) : (
        <Copy size={22} strokeWidth={2.5} aria-hidden />
      )}
    </button>
  );
}

/** "Reconnecting 0:42": the time left until a held Seat is freed, by the server's clock. */
function HeldCountdown({ until, clockOffset }: { until: number; clockOffset: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((until - serverNow(clockOffset, now)) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span data-testid="seat-held" className="tnum">
      {m.seat_reconnecting({ time })}
    </span>
  );
}

export function Lobby() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const lobby = useStore(roomStore, (s) => (s.code === code ? s.lobby : null));
  const me = useStore(roomStore, (s) => s.me);
  const clockOffset = useStore(roomStore, (s) => s.lobbyClockOffset);
  const started = useStore(roomStore, (s) => s.code === code && s.push !== null);
  const [error, setError] = useState<RejectionCode | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const wait = useCountdown(retryAt);
  const passwordJoin = useJoin();
  const { ask } = passwordJoin;

  // Opened by its address: join, and ask for the password if the Room has one.
  useEffect(() => {
    ensureJoined(code).catch((e: unknown) => {
      const rejection = e instanceof JoinError ? e.code : "INTERNAL";
      if (rejection === "WRONG_PASSWORD") ask(code);
      else {
        setError(rejection);
        setRetryAt(retryAtOf(e));
      }
    });
  }, [code, ask]);

  useEffect(() => {
    if (started) void navigate(`/game/${code}`, { replace: true });
  }, [started, code, navigate]);

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <RejectionText code={error} wait={wait} />
        <Link to="/rooms" className={buttonVariants({ variant: "plain" })}>
          {m.back_to_list()}
        </Link>
      </main>
    );
  }

  if (!lobby && passwordJoin.asking) {
    return (
      <div className="min-h-dvh pb-8">
        <ScreenHeader back="/rooms" label={m.back_to_list()} />
        <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pt-10 text-center">
          <h1 className="m-0 text-3xl font-black md:text-4xl">{m.lobby_title()}</h1>
          <PasswordForm
            className="sticker rounded-ui bg-card p-4 text-card-foreground"
            busy={passwordJoin.busy}
            wait={passwordJoin.wait}
            onSubmit={(pw) => void passwordJoin.join(code, pw)}
          />
          {passwordJoin.error && <RejectionText code={passwordJoin.error} />}
        </main>
      </div>
    );
  }

  if (!lobby) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <p className="font-bold">{m.connecting()}</p>
      </main>
    );
  }

  const { maxPlayers, minuteLimit } = lobby.settings;
  const full = lobby.seats.length === maxPlayers;
  const open = Array.from({ length: maxPlayers - lobby.seats.length }, (_, i) => i);

  return (
    <div className="min-h-dvh pb-8">
      <ScreenHeader back="/rooms" label={m.back_to_list()} />
      <ReconnectOverlay />
      <main className="mx-auto max-w-5xl px-4 pt-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="m-0 text-3xl font-black md:text-4xl">
            {roomNameText(lobby.roomName, lobby.code)}
          </h1>
          <RoomCodeSticker code={lobby.code} />
        </div>
        <ul className="m-0 mt-8 flex list-none flex-wrap justify-center gap-4 p-0">
          {lobby.seats.map((seat, i) => (
            <SeatCard
              key={seat.playerId}
              seat={i}
              name={playerName(seat.name)}
              you={seat.playerId === me}
              // The creator's Seat, wherever it is after frees and re-joins.
              creator={seat.playerId === lobby.creatorId}
              bot={seat.bot === true}
              onRemoveBot={
                seat.bot === true
                  ? () => sendIntent({ type: "RemoveBot", playerId: seat.playerId })
                  : undefined
              }
              held={
                seat.heldUntil === undefined ? undefined : (
                  <HeldCountdown until={seat.heldUntil} clockOffset={clockOffset} />
                )
              }
            />
          ))}
          {open.map((i) => (
            // A Bot takes the next empty Seat, so only the first open card offers it.
            <SeatCard
              key={`open-${i}`}
              open
              onAddBot={i === 0 ? () => sendIntent({ type: "AddBot" }) : undefined}
            />
          ))}
        </ul>
        <ul className="sticker m-0 mt-8 grid list-none grid-cols-1 gap-4 rounded-ui bg-card p-4 text-card-foreground sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <Users size={22} strokeWidth={2.5} aria-hidden />
            <span className="text-lg font-black">
              {m.lobby_players({ count: lobby.seats.length, max: maxPlayers })}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Timer size={22} strokeWidth={2.5} aria-hidden />
            <span className="text-lg font-black">
              {m.lobby_minute_limit({ minutes: minuteLimit })}
            </span>
          </li>
          <li className="flex items-center gap-2">
            {lobby.hasPassword ? (
              <Lock size={22} strokeWidth={2.5} aria-hidden />
            ) : (
              <LockOpen size={22} strokeWidth={2.5} aria-hidden />
            )}
            <span className="text-lg font-black">
              {lobby.hasPassword ? m.lobby_has_password() : m.lobby_no_password()}
            </span>
          </li>
        </ul>
        <Button
          size="lg"
          className="mt-6 w-full"
          disabled={!full}
          onClick={() => sendIntent({ type: "Start" })}
        >
          {m.lobby_start()}
        </Button>
        {!full && (
          <p className="mt-3 text-center font-bold text-muted-foreground">{m.lobby_waiting()}</p>
        )}
      </main>
    </div>
  );
}
