import { BrowserRouter, Route, Routes } from "react-router";
import { Game } from "#screens/Game.tsx";
import { Home } from "#screens/Home.tsx";
import { Lobby } from "#screens/Lobby.tsx";

/** Routes (declarative React Router; the Lobby list and create form land with #36). */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<Lobby />} />
        <Route path="/game/:code" element={<Game />} />
      </Routes>
    </BrowserRouter>
  );
}
