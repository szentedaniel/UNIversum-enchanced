import {
  DEFAULT_SETTINGS,
  MINUTE_LIMITS,
  PASSWORD_MAX_BYTES,
  PLAYER_COUNTS,
  STARTING_CASHES,
  TURN_LIMITS,
  utf8Length,
  type RejectionCode,
  type RoomSettings,
} from "@universum/protocol/messages";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ScreenHeader } from "#components/ScreenHeader.tsx";
import { Button } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { Input } from "#components/ui/input.tsx";
import { Label } from "#components/ui/label.tsx";
import { createRoom, JoinError, leaveRoom } from "#connection.ts";
import { AlertText, RejectionText, retryAtOf, useCountdown, waitLabel } from "#screens/join.tsx";
import { formatCompactCash, m } from "#text.ts";

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
  const [startingCash, setStartingCash] = useState<RoomSettings["startingCash"]>(
    DEFAULT_SETTINGS.startingCash,
  );
  const [turnLimitMs, setTurnLimitMs] = useState<RoomSettings["turnLimitMs"]>(
    DEFAULT_SETTINGS.turnLimitMs,
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RejectionCode | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const wait = useCountdown(retryAt);
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;

  useEffect(() => {
    void leaveRoom();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tooLong || wait > 0) return;
    setBusy(true);
    setError(null);
    setRetryAt(null);
    try {
      const code = await createRoom({
        roomName,
        maxPlayers,
        minuteLimit,
        startingCash,
        turnLimitMs,
        ...(password && { password }),
      });
      await navigate(`/room/${code}`);
    } catch (e) {
      setError(e instanceof JoinError ? e.code : "INTERNAL");
      setRetryAt(retryAtOf(e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh pb-8">
      <ScreenHeader back="/rooms" label={m.back_to_list()} />
      <main className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 pt-6">
        <h1 className="m-0 text-center text-3xl font-black md:text-4xl">{m.create_title()}</h1>
        <Card className="w-full p-4">
          <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-name">{m.create_room_name()}</Label>
              <Input
                id="room-name"
                value={roomName}
                maxLength={64}
                autoComplete="off"
                aria-describedby="room-name-hint"
                onChange={(e) => setRoomName(e.target.value)}
              />
              <p id="room-name-hint" className="m-0 text-sm font-bold text-ink/70">
                {m.create_room_name_hint()}
              </p>
            </div>
            <Segments legend={m.create_players()}>
              {PLAYER_COUNTS.map((count) => (
                <Segment
                  key={count}
                  name="players"
                  checked={maxPlayers === count}
                  onChange={() => setMaxPlayers(count)}
                >
                  {count}
                </Segment>
              ))}
            </Segments>
            <Segments legend={m.create_minute_limit()}>
              {MINUTE_LIMITS.map((minutes) => (
                <Segment
                  key={minutes}
                  name="minutes"
                  checked={minuteLimit === minutes}
                  onChange={() => setMinuteLimit(minutes)}
                >
                  {m.lobby_minute_limit({ minutes })}
                </Segment>
              ))}
            </Segments>
            <Segments legend={m.create_starting_cash()}>
              {STARTING_CASHES.map((cash) => (
                <Segment
                  key={cash}
                  name="starting-cash"
                  checked={startingCash === cash}
                  onChange={() => setStartingCash(cash)}
                >
                  {formatCompactCash(cash)}
                </Segment>
              ))}
            </Segments>
            <Segments legend={m.create_turn_timer()}>
              {TURN_LIMITS.map((limitMs) => (
                <Segment
                  key={limitMs}
                  name="turn-timer"
                  checked={turnLimitMs === limitMs}
                  onChange={() => setTurnLimitMs(limitMs)}
                >
                  {m.create_turn_seconds({ seconds: limitMs / 1_000 })}
                </Segment>
              ))}
            </Segments>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-password">{m.create_password()}</Label>
              <Input
                id="room-password"
                type="password"
                autoComplete="new-password"
                value={password}
                aria-invalid={tooLong || undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {tooLong && <AlertText>{m.password_too_long()}</AlertText>}
            <Button type="submit" size="lg" disabled={busy || tooLong || wait > 0}>
              {waitLabel(wait, m.home_create())}
            </Button>
            {error && <RejectionText code={error} />}
          </form>
        </Card>
      </main>
    </div>
  );
}

/** A row of chunky single-choice segments (Players, Minute limit, starting cash, Turn timer). */
function Segments({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-sm font-extrabold tracking-wide uppercase opacity-70">
        {legend}
      </legend>
      <div className="flex w-full gap-2">{children}</div>
    </fieldset>
  );
}

/** One radio of a `Segments` row; the checked one is primary. */
function Segment({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="relative flex-1">
      <input
        type="radio"
        name={name}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none opacity-0"
        checked={checked}
        onChange={onChange}
      />
      <span className="sticker-sm press tnum flex h-12 cursor-pointer items-center justify-center rounded-xl bg-background px-2 text-center text-base font-black text-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
        {children}
      </span>
    </label>
  );
}
