/**
 * Joining a Room by its Room code, from home, the Lobby list or the Room's
 * own address: taking a Seat or watching without one (spec #179), with the
 * one password prompt and the inline Rejections both share.
 */
import { PASSWORD_MAX_BYTES, utf8Length, type RejectionCode } from "@universum/protocol/messages";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ROOM_CODE_LENGTH, RoomCodeInput } from "#components/RoomCodeInput.tsx";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Label } from "#components/ui/label.tsx";
import { JoinError, joinRoom, watchRoom } from "#connection.ts";
import { cn } from "#lib/utils.ts";
import { m, rejectionText } from "#text.ts";

type JoinState = {
  /** The Room code of the last join tried; `asking` and `error` belong to it. */
  code: string | null;
  /** Whether that try watched without a Seat: its password prompt and retry repeat the same one. */
  asSpectator: boolean;
  /** The Room needs a password before a Seat is taken (or the Guest starts watching). */
  asking: boolean;
  error: RejectionCode | null;
  busy: boolean;
  /** When a refusal with a wait lets the Guest try again (epoch ms). */
  retryAt: number | null;
};

const idle: JoinState = {
  code: null,
  asSpectator: false,
  asking: false,
  error: null,
  busy: false,
  retryAt: null,
};

/** When a refused create or join may be tried again (epoch ms), if the server named a wait. */
export const retryAtOf = (error: unknown): number | null =>
  error instanceof JoinError && error.retryAfter !== null
    ? Date.now() + error.retryAfter * 1000
    : null;

/** Whole seconds left until `until` (epoch ms), ticking down; 0 once it has passed or for `null`. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return undefined;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Whether the password form already open belongs to this very try: the same
 * Room code and the same action. The try keeps it open, and so does a refusal
 * with a wait (`PASSWORD_LOCKED`, `RATE_LIMITED`).
 */
const askingFor = (state: JoinState, code: string, asSpectator: boolean): boolean =>
  state.code === code && state.asSpectator === asSpectator && state.asking;

/**
 * Joining or watching a Room and opening its Lobby; a password Room first asks
 * for its password, whichever of the two the Guest chose.
 */
export function useJoin() {
  const navigate = useNavigate();
  const [state, setState] = useState<JoinState>(idle);

  async function attempt(code: string, asSpectator: boolean, password?: string): Promise<void> {
    setState((s) => ({
      code,
      asSpectator,
      asking: askingFor(s, code, asSpectator),
      error: null,
      busy: true,
      retryAt: null,
    }));
    try {
      if (asSpectator) await watchRoom(code, password);
      else await joinRoom(code, password);
      await navigate(`/room/${code}`);
    } catch (e) {
      const error = e instanceof JoinError ? e.code : "INTERNAL";
      const asking = error === "WRONG_PASSWORD";
      // No password given yet: that is a question, not a mistake.
      setState({
        code,
        asSpectator,
        // A wait (PASSWORD_LOCKED, RATE_LIMITED) keeps the password form open, its button counting down.
        asking:
          asking ||
          (askingFor(state, code, asSpectator) && e instanceof JoinError && e.retryAfter !== null),
        error: asking && password === undefined ? null : error,
        busy: false,
        retryAt: retryAtOf(e),
      });
    }
  }

  /** Takes a Seat in the Room. */
  const join = (code: string, password?: string) => attempt(code, false, password);
  /** Watches the Room without a Seat (spec #179). */
  const watch = (code: string, password?: string) => attempt(code, true, password);

  /** Asks for the password of a Room known to have one, before trying to join. */
  const ask = useCallback((code: string): void => {
    setState({ code, asSpectator: false, asking: true, error: null, busy: false, retryAt: null });
  }, []);

  /** Seconds until a refused join may be tried again; 0: now. */
  const wait = useCountdown(state.retryAt);

  return { ...state, wait, join, watch, ask };
}

/** An inline error: a small pink sticker pill. */
export function AlertText({ children, className }: { children: string; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        "sticker-sm m-0 rounded-full bg-[#ffd0d0] px-4 py-1 text-center font-bold text-ink",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A button's label: `label`, or the countdown while a refusal makes the Guest wait. */
export const waitLabel = (wait: number, label: string): string =>
  wait > 0 ? m.retry_in({ seconds: wait }) : label;

export function PasswordForm({
  busy,
  wait = 0,
  label = m.home_join(),
  onSubmit,
  className,
}: {
  busy: boolean;
  /** Seconds before the Guest may try again (`PASSWORD_LOCKED`, `RATE_LIMITED`). */
  wait?: number;
  /** The submit button's label: the action the password is asked for. */
  label?: string;
  onSubmit: (password: string) => void;
  className?: string;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password && !tooLong && wait === 0) onSubmit(password);
  }

  return (
    <form
      className={cn("password flex w-full flex-col gap-2 text-left", className)}
      onSubmit={submit}
    >
      <p className="m-0 font-bold">{m.password_prompt()}</p>
      <Label htmlFor={id}>{m.password_label()}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={password}
          aria-invalid={tooLong || undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="accent" disabled={busy || !password || tooLong || wait > 0}>
          {waitLabel(wait, label)}
        </Button>
      </div>
      {tooLong && <AlertText>{m.password_too_long()}</AlertText>}
    </form>
  );
}

/** An inline Rejection; with `wait`, the countdown follows (for screens without a button to show it). */
export function RejectionText({ code, wait = 0 }: { code: RejectionCode; wait?: number }) {
  const text = rejectionText(code);
  return <AlertText>{wait > 0 ? `${text} ${m.retry_in({ seconds: wait })}` : text}</AlertText>;
}

/** The Room code boxes, Join and Watch, with the password prompt when the Room has one. */
export function JoinByCode() {
  const {
    code: tried,
    asSpectator: triedAsSpectator,
    asking,
    error,
    busy,
    wait,
    join,
    watch,
  } = useJoin();
  const [code, setCode] = useState("");
  const current = tried === code;
  const codeComplete = code.length === ROOM_CODE_LENGTH && wait === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (codeComplete) void join(code);
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <form
        className="join sticker flex flex-wrap items-center justify-center gap-2 rounded-ui bg-card p-2 text-card-foreground"
        onSubmit={submit}
      >
        <RoomCodeInput value={code} onValueChange={setCode} disabled={busy} />
        <Button type="submit" variant="accent" disabled={busy || !codeComplete}>
          {waitLabel(wait, m.home_join())}
        </Button>
        {/* Watching takes no Seat (spec #179): its own action, so a full or started Room is no mistake. */}
        <Button
          type="button"
          variant="plain"
          data-testid="watch"
          disabled={busy || !codeComplete}
          onClick={() => void watch(code)}
        >
          {m.watch_button()}
        </Button>
      </form>
      {current && asking && (
        <PasswordForm
          label={triedAsSpectator ? m.watch_button() : m.home_join()}
          className="sticker rounded-ui bg-card p-3 text-card-foreground"
          busy={busy}
          wait={wait}
          onSubmit={(pw) => void (triedAsSpectator ? watch(code, pw) : join(code, pw))}
        />
      )}
      {current && error && <RejectionText code={error} />}
    </div>
  );
}
