import { useEffect } from "react";
import { Link } from "react-router";
import { leaveRoom } from "#connection.ts";
import { JoinByCode } from "#screens/join.tsx";
import { m } from "#text.ts";

export function Home() {
  // Coming home leaves any Room (its Lobby Seat is freed).
  useEffect(() => {
    void leaveRoom();
  }, []);

  return (
    <main className="screen home">
      <h1 className="logo">{m.logo()}</h1>
      <nav className="actions">
        <Link className="button primary" to="/create">
          {m.home_create()}
        </Link>
        <Link className="button" to="/rooms">
          {m.home_lobby_list()}
        </Link>
      </nav>
      <p>{m.home_or_join()}</p>
      <JoinByCode />
    </main>
  );
}
