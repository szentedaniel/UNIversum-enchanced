/**
 * Joining a Room by its Room code, from home, the Lobby list or the Room's
 * own address: the password prompt and the inline Rejections.
 */
import { PASSWORD_MAX_BYTES, utf8Length, type RejectionCode } from "@universum/protocol/messages";
import { useCallback, useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ROOM_CODE_LENGTH, RoomCodeInput } from "#components/RoomCodeInput.tsx";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Label } from "#components/ui/label.tsx";
import { JoinError, joinRoom } from "#connection.ts";
import { cn } from "#lib/utils.ts";
import { m, rejectionText } from "#text.ts";

type JoinState = {
  /** The Room code of the last join tried; `asking` and `error` belong to it. */
  code: string | null;
  /** The Room needs a password before a Seat is taken. */
  asking: boolean;
  error: RejectionCode | null;
  busy: boolean;
};

const idle: JoinState = { code: null, asking: false, error: null, busy: false };

/** Joins a Room and opens its Lobby; a password Room first asks for its password. */
export function useJoin() {
  const navigate = useNavigate();
  const [state, setState] = useState<JoinState>(idle);

  async function join(code: string, password?: string): Promise<void> {
    setState((s) => ({ code, asking: s.code === code && s.asking, error: null, busy: true }));
    try {
      await joinRoom(code, password);
      await navigate(`/room/${code}`);
    } catch (e) {
      const error = e instanceof JoinError ? e.code : "INTERNAL";
      const asking = error === "WRONG_PASSWORD";
      // No password given yet: that is a question, not a mistake.
      setState({
        code,
        asking,
        error: asking && password === undefined ? null : error,
        busy: false,
      });
    }
  }

  /** Asks for the password of a Room known to have one, before trying to join. */
  const ask = useCallback((code: string): void => {
    setState({ code, asking: true, error: null, busy: false });
  }, []);

  return { ...state, join, ask };
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

export function PasswordForm({
  busy,
  onSubmit,
  className,
}: {
  busy: boolean;
  onSubmit: (password: string) => void;
  className?: string;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password && !tooLong) onSubmit(password);
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
        <Button type="submit" variant="accent" disabled={busy || !password || tooLong}>
          {m.home_join()}
        </Button>
      </div>
      {tooLong && <AlertText>{m.password_too_long()}</AlertText>}
    </form>
  );
}

export function RejectionText({ code }: { code: RejectionCode }) {
  return <AlertText>{rejectionText(code)}</AlertText>;
}

/** The Room code boxes and Join button, with the password prompt when the Room has one. */
export function JoinByCode() {
  const { code: tried, asking, error, busy, join } = useJoin();
  const [code, setCode] = useState("");
  const current = tried === code;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length === ROOM_CODE_LENGTH) void join(code);
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <form
        className="join sticker flex flex-wrap items-center justify-center gap-2 rounded-ui bg-card p-2 text-card-foreground"
        onSubmit={submit}
      >
        <RoomCodeInput value={code} onValueChange={setCode} disabled={busy} />
        <Button type="submit" variant="accent" disabled={busy || code.length !== ROOM_CODE_LENGTH}>
          {m.home_join()}
        </Button>
      </form>
      {current && asking && (
        <PasswordForm
          className="sticker rounded-ui bg-card p-3 text-card-foreground"
          busy={busy}
          onSubmit={(pw) => void join(code, pw)}
        />
      )}
      {current && error && <RejectionText code={error} />}
    </div>
  );
}
