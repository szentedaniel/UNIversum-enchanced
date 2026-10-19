import { Modal } from '@mantine/core'
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import pinkAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienPink.png'
import blueAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienBlue.png'
import yellowAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienYellow.png'
import greenAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienGreen.png'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../../Contexts/SocketContext'
import { resetState } from '../../Store/slices/gameStateSlice'

export default function Winner() {
  const { gameOver, winnerColor } = useSelector((state) => state.gameState)
  const navigate = useNavigate()
  const socket = useSocket()
  const dispatch = useDispatch()

  const [opened, setOpened] = useState(false)

  let image = pinkAvatar
  if (winnerColor === 1) {
    image = blueAvatar
  } else if (winnerColor === 2) {
    image = greenAvatar
  } else if (winnerColor === 2) {
    image = yellowAvatar
  }

  useEffect(() => {
    if (gameOver) {
      setOpened(true)
    } else { setOpened(false) }
  }, [gameOver])

  const onColseHandler = () => {
    setOpened(false)
    navigate('/')
    dispatch(resetState())
    socket.emit('leave_room')

  }

  return (
    <>
      <Modal
        size="lg"
        // size="calc(100vw - 20vw)"
        centered
        opened={opened}
        onClose={onColseHandler}
        title={'győzelem'.toUpperCase()}
        transition='slide-up'
        transitionDuration={300}
        transitiontimingfunction='ease'
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
        radius={'lg'}
        classNames={{ modal: 'bg-[#F5ECE3] text-center' }}
      //overlayColor={'#F5ECE3'}
      >
        <div className='flex flex-col justify-center items-center w-auto'>
          <div className='flex flex-col items-center content-center w-32 h-32 rounded m-3 drop-shadow-md'>
            <img src={image} alt="winner" />
          </div>

          <div className='flex flex-col w-4/5 h-32 rounded-lg bg-[#eedac6] self-center items-center justify-evenly mb-3 p-3 leading-5'>
            <span>Gratulálunk!!!</span>
            <p><span></span></p>
          </div>

          <div
            onClick={onColseHandler}
            className='flex w-fit h-fit px-4 py-2 bg-orange-300 border-orange-100 border-4 cursor-pointer rounded-full items-center justify-center hover:bg-orange-400 shadow-lg'>Csodás</div>
        </div>

      </Modal>
    </>

  )
}
