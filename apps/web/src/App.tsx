import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { fieldVisible } from "#lib/safe-area.ts";
import { CreateRoom } from "#screens/CreateRoom.tsx";
import { Game } from "#screens/Game.tsx";
import { Home } from "#screens/Home.tsx";
import { Lobby } from "#screens/Lobby.tsx";
import { LobbyList } from "#screens/LobbyList.tsx";

/** Routes (declarative React Router, no loaders or actions). */
export function App() {
  // Most browsers scroll a focused input into view themselves; this catches the
  // ones that leave it under the on-screen keyboard once the visual viewport
  // shrinks (window.visualViewport reports the part of the screen still shown).
  useEffect(() => {
    const viewport = window.visualViewport;
    const nudge = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
      if (viewport === null) return;
      if (fieldVisible(active.getBoundingClientRect(), viewport)) return;
      active.scrollIntoView({ block: "center", inline: "nearest" });
    };
    const onFocusIn = () => requestAnimationFrame(nudge);
    document.addEventListener("focusin", onFocusIn);
    viewport?.addEventListener("resize", nudge);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      viewport?.removeEventListener("resize", nudge);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rooms" element={<LobbyList />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/room/:code" element={<Lobby />} />
        <Route path="/game/:code" element={<Game />} />
      </Routes>
    </BrowserRouter>
  );
}
