/**
 * Joining a Room by its Room code, from home, the Lobby list or the Room's
 * own address: the password prompt and the inline Rejections.
 */
import { PASSWORD_MAX_BYTES, utf8Length, type RejectionCode } from "@universum/protocol/messages";
import { useCallback, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { JoinError, joinRoom } from "#connection.ts";
import { m, rejectionText } from "#text.ts";

export const CODE_LENGTH = 6;

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

export function PasswordForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password && !tooLong) onSubmit(password);
  }

  return (
    <form className="password" onSubmit={submit}>
      <p>{m.password_prompt()}</p>
      <label>
        {m.password_label()}
        <input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy || !password || tooLong}>
        {m.home_join()}
      </button>
      {tooLong && (
        <p role="alert" className="error">
          {m.password_too_long()}
        </p>
      )}
    </form>
  );
}

export function RejectionText({ code }: { code: RejectionCode }) {
  return (
    <p role="alert" className="error">
      {rejectionText(code)}
    </p>
  );
}

/** The Room code field and Join button, with the password prompt when the Room has one. */
export function JoinByCode() {
  const { code: tried, asking, error, busy, join } = useJoin();
  const [code, setCode] = useState("");
  const current = tried === code;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length === CODE_LENGTH) void join(code);
  }

  return (
    <>
      <form className="join" onSubmit={submit}>
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
      {current && asking && <PasswordForm busy={busy} onSubmit={(pw) => void join(code, pw)} />}
      {current && error && <RejectionText code={error} />}
    </>
  );
}
