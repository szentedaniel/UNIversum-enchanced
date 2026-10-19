import '../App.css';
import React from "react";
import Particles from 'react-tsparticles';
import { SocketProvider } from '../Contexts/SocketContext';
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Toaster } from 'react-hot-toast';




import Create from '../Pages/Create'
import Rooms from '../Pages//Rooms'
import Room from '../Pages/Room'
import LangSelector from './LangSelector';
import Logo from './Logo'
import Home from '../Pages/Home';
import Loading from './Loading';
import InitSomeStuff from './InitSomeStuff';
import Game from '../Pages/Game';

function App() {
  const particlesInit = (main) => {
    console.log(main);

    // you can initialize the tsParticles instance (main) here, adding custom shapes or presets
  };

  const particlesLoaded = (container) => {
    console.log(container);
  };
  return (
    <SocketProvider>

      <InitSomeStuff />
      {/* <LangSelector /> */}
      <Loading />
      <Toaster
        position="bottom-left"
        reverseOrder={false}
      />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/create" element={<Create />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="/game/:code" element={<Game />} />
        </Routes>
      </BrowserRouter>
      {/* <BrowserRouter>
        <Routes>
          
        </Routes>
      </BrowserRouter> */}
    </SocketProvider>
  );
}

export default App;
