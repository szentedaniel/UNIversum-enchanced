import { BrowserRouter, Route, Routes } from "react-router";
import { CreateRoom } from "#screens/CreateRoom.tsx";
import { Game } from "#screens/Game.tsx";
import { Home } from "#screens/Home.tsx";
import { Lobby } from "#screens/Lobby.tsx";
import { LobbyList } from "#screens/LobbyList.tsx";

/** Routes (declarative React Router, no loaders or actions). */
export function App() {
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
