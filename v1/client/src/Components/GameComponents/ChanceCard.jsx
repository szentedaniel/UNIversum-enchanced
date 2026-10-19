import { Modal } from '@mantine/core'
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { applyCardEffect, nextPlayer, resetCountdown, setShowCard } from '../../Store/slices/gameStateSlice'
import trophy from '../../Images/game/emojis/trophy.png'
import { GAME_CONFIG } from '../../gameConfig'
import { useSocket } from '../../Contexts/SocketContext'

export default function ChanceCard(props) {
  const { showCard, selectedCard } = useSelector((state) => state.gameState)
  const dispatch = useDispatch()
  const [opened, setOpened] = useState(false)
  const socket = useSocket()
  const { RoundOnMe } = props

  useEffect(() => {
    if (showCard) {
      dispatch(resetCountdown())
      setOpened(true)
    } else { setOpened(false) }
  }, [showCard])

  useEffect(() => {
    socket.off('close_chance_res').on('close_chance_res', (id) => {
      if (id !== socket.id) onColseHandler()
    })

    return () => {
      // socket.off('step_on_field_controller_res')
    }
  })

  const onColseHandler = () => {
    if (RoundOnMe) emitClose()
    setOpened(false)
    dispatch(resetCountdown())
    dispatch(applyCardEffect())
    setTimeout(() => {
      dispatch(setShowCard(false))
      dispatch(nextPlayer())
    }, 400)
  }

  const emitClose = () => {
    socket.emit('close_chance_req')
  }

  return (
    <>
      <Modal
        size="lg"
        // size="calc(100vw - 20vw)"
        centered
        opened={opened}
        onClose={onColseHandler}
        title={GAME_CONFIG.cards[selectedCard].title}
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
            <img src={trophy} alt="biohazad" />
          </div>

          <div className='flex flex-col w-4/5 h-32 rounded-lg bg-[#eedac6] self-center items-center justify-evenly mb-3 p-3 leading-5'>
            <span>{GAME_CONFIG.cards[selectedCard].desc}</span>
          </div>

          {RoundOnMe &&
            <div
              onClick={onColseHandler}
              className='flex w-fit h-fit px-4 py-2 bg-orange-300 border-orange-100 border-4 cursor-pointer rounded-full items-center justify-center hover:bg-orange-400 shadow-lg'>
              Megértettem
            </div>}
        </div>

      </Modal>
    </>

  )
}
