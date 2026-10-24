import type { LobbyListing } from "@universum/protocol/messages";
import { Lock, Plus, Timer, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ScreenHeader } from "#components/ScreenHeader.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { leaveRoom, watchLobbyList } from "#connection.ts";
import { JoinByCode, PasswordForm, RejectionText, useJoin, waitLabel } from "#screens/join.tsx";
import { m, roomNameText } from "#text.ts";

/** `/rooms`: every open Lobby, live; a started game leaves the list. */
export function LobbyList() {
  const [lobbies, setLobbies] = useState<LobbyListing[] | null>(null);
  const { code: tried, asking, error, busy, wait, join, ask } = useJoin();

  // Coming back to the list leaves any Room (its Lobby Seat is freed).
  useEffect(() => {
    void leaveRoom();
  }, []);

  useEffect(() => watchLobbyList(setLobbies), []);

  return (
    <div className="min-h-dvh pb-8">
      <ScreenHeader back="/" label={m.back_home()} />
      <main className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 pt-6">
        <h1 className="m-0 text-center text-3xl font-black md:text-4xl">{m.rooms_title()}</h1>
        <div className="flex w-full flex-col items-center gap-4 md:flex-row md:items-start md:justify-center">
          <Link to="/create" className={buttonVariants({ className: "w-full max-w-md md:w-auto" })}>
            <Plus size={22} strokeWidth={3} aria-hidden />
            {m.home_create()}
          </Link>
          <JoinByCode />
        </div>
        {lobbies === null && <p className="m-0 font-bold">{m.connecting()}</p>}
        {lobbies?.length === 0 && (
          <p className="m-0 font-bold text-muted-foreground">{m.rooms_empty()}</p>
        )}
        {lobbies && lobbies.length > 0 && (
          <ul className="m-0 grid w-full list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {lobbies.map((lobby) => {
              const full = lobby.players >= lobby.maxPlayers;
              const current = tried === lobby.code;
              return (
                <li key={lobby.code} data-testid={`lobby-${lobby.code}`}>
                  <Card className="h-full gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="m-0 text-xl leading-tight font-black">
                        {roomNameText(lobby.roomName, lobby.code)}
                      </h2>
                      {lobby.hasPassword && (
                        <p className="m-0 inline-flex shrink-0 items-center gap-1 text-sm font-extrabold">
                          <Lock size={16} strokeWidth={3} aria-hidden />
                          {m.rooms_has_password()}
                        </p>
                      )}
                    </div>
                    <p className="tnum m-0 text-sm font-bold text-ink/70">
                      {m.lobby_code({ code: lobby.code })}
                    </p>
                    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 font-bold">
                      <span className="inline-flex items-center gap-1">
                        <Users size={18} strokeWidth={2.5} aria-hidden />
                        {m.lobby_players({ count: lobby.players, max: lobby.maxPlayers })}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Timer size={18} strokeWidth={2.5} aria-hidden />
                        {m.lobby_minute_limit({ minutes: lobby.minuteLimit })}
                      </span>
                    </p>
                    {full ? (
                      <p className="m-0 font-display text-lg text-ink/70">{m.rooms_full()}</p>
                    ) : (
                      !(current && asking) && (
                        <Button
                          variant="accent"
                          className="mt-auto"
                          disabled={busy || wait > 0}
                          onClick={() =>
                            lobby.hasPassword ? ask(lobby.code) : void join(lobby.code)
                          }
                        >
                          {waitLabel(wait, m.home_join())}
                        </Button>
                      )
                    )}
                    {current && asking && !full && (
                      <PasswordForm
                        busy={busy}
                        wait={wait}
                        onSubmit={(pw) => void join(lobby.code, pw)}
                      />
                    )}
                    {current && error && <RejectionText code={error} />}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
