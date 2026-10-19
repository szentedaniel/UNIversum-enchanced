import React, { useEffect, useState } from 'react'
import { useElementSize, useFullscreen } from '@mantine/hooks';
import { useDispatch, useSelector } from 'react-redux';
import { setIsGame } from '../Store/slices/loadingSlice';
import GameComponentNew from '../Components/GameComponentNew';
import FullscreenSwitcher from '../Components/GameComponents/FullscreenSwitcher';
import { useParams } from 'react-router-dom';
import { useSocket } from '../Contexts/SocketContext'
import { useNavigate } from "react-router-dom";
import { setGameState } from '../Store/slices/gameStateSlice';


export default function Game(props) {
  const { toggle, fullscreen } = useFullscreen()
  const { username } = useSelector((state) => state.user)

  const dispatch = useDispatch()
  dispatch(setIsGame(true))
  const [bg, setBg] = useState(null)
  const { code } = useParams();
  const navigate = useNavigate()
  const socket = useSocket()
  console.log(code);

  const getGameDataByCode = (code) => {
    socket.emit('get_game_data_by_code_req', code.toString())
  }
  // console.log(username);


  useEffect(() => {
    if (!bg) {
      setBg(Math.floor(Math.random() * 8 + 1))
    }

    socket.on('get_game_data_by_code_res', gameState => {
      // console.log(gameState);
      if (gameState.status === 200) {
        const usernames = gameState.players.map(x => x.username)
        // console.log(usernames.includes(username));
        if (usernames.includes(username)) {
          dispatch(setGameState(gameState))
        } else {
          navigate('/')
        }
      } else {
        navigate('/')
      }
    })
    getGameDataByCode(code)


    return () => {
      socket.off('get_game_data_by_code_res')
    }
  }, [])

  useEffect(() => {
    window.addEventListener("beforeunload", alertUser);
    return () => {
      window.removeEventListener("beforeunload", alertUser);
    };
  }, []);
  const alertUser = (e) => {
    e.preventDefault();
    e.returnValue = "";
  };


  return (
    <>
      <div className={` blur-[2px] absolute top-0 overflow-hidden left-0 w-full h-full items-center content-center justify-center flex z-10 bg-repeat-x ${(fullscreen && 'bg-contain')}`} style={{
        backgroundImage: `url(../Images/game/background-elements-redux-fix/Backgrounds/${bg}.png)`
      }} >
      </div >
      < div className='absolute top-0 overflow-hidden left-0 w-full h-full items-center content-center justify-center flex z-10 bg-repeat-x' >
        {/* bg-gradient-to-t from-blue-200 to-blue-400 rounded-lg */}
        {/* <GameComponent
                width={width}
                height={height}
            /> */}
        <GameComponentNew username={username} />
        <FullscreenSwitcher
          toggle={toggle}
          fullscreen={fullscreen}
        />

      </div >
    </>
  )
}
