import { ArrowLeft, Check, Copy, Timer, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { Logo } from "#components/Logo.tsx";
import { SeatCard } from "#components/SeatCard.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { roomStore } from "#stores/room-store.ts";
import { m, playerName, rejectionText } from "#text.ts";
import type { RejectionCode } from "@universum/protocol/messages";

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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p
          role="alert"
          className="sticker-sm m-0 rounded-full bg-[#ffd0d0] px-4 py-1 font-bold text-ink"
        >
          {rejectionText(error)}
        </p>
        <Link to="/" className={buttonVariants({ variant: "plain" })}>
          {m.back_home()}
        </Link>
      </main>
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
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pt-5">
        <Link
          to="/"
          className={buttonVariants({ variant: "plain", size: "sm", className: "rounded-full" })}
        >
          <ArrowLeft size={18} strokeWidth={3} aria-hidden />
          {m.back_home()}
        </Link>
        <Logo small />
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="m-0 text-3xl font-black md:text-4xl">{m.lobby_title()}</h1>
          <RoomCodeSticker code={lobby.code} />
        </div>
        <ul className="m-0 mt-8 flex list-none flex-wrap justify-center gap-4 p-0">
          {lobby.seats.map((seat, i) => (
            <SeatCard
              key={seat.playerId}
              seat={i}
              name={playerName(seat.name)}
              you={seat.playerId === me}
              // Seats are in join order; while the creator stays, theirs is the first.
              creator={i === 0}
            />
          ))}
          {open.map((i) => (
            <SeatCard key={`open-${i}`} open />
          ))}
        </ul>
        <ul className="sticker m-0 mt-8 grid list-none grid-cols-2 gap-4 rounded-ui bg-card p-4 text-card-foreground">
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
