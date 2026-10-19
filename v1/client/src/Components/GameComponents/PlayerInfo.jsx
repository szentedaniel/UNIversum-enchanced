import React from 'react'
import pinkAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienPink.png'
import blueAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienBlue.png'
import yellowAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienYellow.png'
import greenAvatar from '../../Images/game/moreenemiesanimations/Alien sprites/alienGreen.png'
import { Progress } from '@mantine/core'
import { useEffect } from 'react'
import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { autoSellSelectedFields, nextPlayer, setShowSell, resetCountdown as resetCountdownFunc, payTax, setShowTax, QuarantineRoundsDowner, doPunishment } from '../../Store/slices/gameStateSlice'
import { useSocket } from '../../Contexts/SocketContext'


export default function PlayerInfo(props) {
  const { players, currentPlayer, resetCountdown, showSell, showTax, showQuarantineTab, lastDiceRoll, gameOver, RoundOnMe } = props

  const [Players, setPlayers] = useState(players)
  useEffect(() => {
    setPlayers(players)

    return () => {
      setPlayers(players)
    }
  }, [players])

  return (
    <>
      {
        Players.map(player => (
          <PlayerInfoPiece {...player} key={player.colorCode} RoundOnMe={RoundOnMe} currentPlayer={currentPlayer} gameOver={gameOver} lastDiceRoll={lastDiceRoll} showTax={showTax} showQuarantineTab={showQuarantineTab} resetCountdown={resetCountdown} showSell={showSell} />
        ))
      }

    </>
  )
}



function PlayerInfoPiece(props) {
  const { colorCode, username, money, currentPlayer, playerCountdown, resetCountdown, isBankrupt, showSell, showTax, showQuarantineTab, gameOver, RoundOnMe } = props
  const dispatch = useDispatch()
  const [Username, setUsername] = useState(username)
  const socket = useSocket()

  const [remain, setRemain] = useState(0)
  let img = pinkAvatar
  let color = 'pink'
  let bgColor = 'bg-pink-300'
  let borderColor = 'border-pink-300'
  let position = 'top-0 left-0'

  if (colorCode === 1) {
    img = blueAvatar
    color = 'blue'
    bgColor = 'bg-blue-300'
    borderColor = 'border-blue-300'
    position = 'top-0 right-0'
  } else if (colorCode === 2) {
    img = greenAvatar
    color = 'green'
    bgColor = 'bg-green-300'
    borderColor = 'border-green-300'
    position = 'bottom-0 right-0'
  } else if (colorCode === 3) {
    img = yellowAvatar
    color = 'yellow'
    bgColor = 'bg-yellow-300'
    borderColor = 'border-yellow-300'
    position = 'bottom-0 left-0'
  } else {
    img = pinkAvatar
    color = 'pink'
    bgColor = 'bg-pink-300'
    borderColor = 'border-pink-300'
    position = 'top-0 left-0'
  }

  if (isBankrupt) {
    color = 'gray'
    bgColor = 'bg-gray-300'
    borderColor = 'border-gray-300'
  }

  useEffect(() => {
    setUsername(username)

    return () => {
      setUsername('')
    }
  }, [username])

  useEffect(() => {
    socket.off('time_over_res').on('time_over_res', (id) => { if(id !== socket.id) timeOver()})
  })
  

  useEffect(() => {
    if (currentPlayer === colorCode) {

      const target = new Date(Date.now() + 22000).getTime()
      const interval = setInterval(() => {

        const now = new Date().getTime()
        const distance = (target - now)
        setRemain(Math.floor((distance % (1000 * 60)) / 1000))

      }, 1000)
      return () => {
        clearInterval(interval)
        setRemain(20)
      }
    }
  }, [colorCode, currentPlayer, playerCountdown, resetCountdown])

  const timeOver = () => {
    if (remain < 0 && gameOver === false) {
      if (RoundOnMe) emitTimeOver()
      console.log('lejart');
      // dispatch(setDiceRollValue(0))
      if (showSell) {
        dispatch(resetCountdownFunc())
        dispatch(autoSellSelectedFields())
        dispatch(doPunishment())

        setTimeout(() => {
          dispatch(setShowSell({ value: false, from: '' }))
        }, 400);
      } else if (showTax) {
        dispatch(resetCountdownFunc())
        dispatch(payTax())
        dispatch(setShowTax(false))
        dispatch(doPunishment())

      } else if (showQuarantineTab) {
        dispatch(QuarantineRoundsDowner())
        dispatch(nextPlayer())

      } else {
        dispatch(resetCountdownFunc())
        dispatch(doPunishment())
        dispatch(nextPlayer())
      }
    }
  }
  const emitTimeOver = () => {
    socket.emit('time_over_req')
  }

  useEffect(() => {
    timeOver()
    return () => {
    }
  }, [remain])




  const formatter = new Intl.NumberFormat('hu-HU', {
    style: 'currency',
    currency: 'HUF',
    minimumFractionDigits: 0
  })
  return (
    <div className={`w-56 h-32 bg-[#F5ECE3] absolute ${position} rounded-xl border-8 ${borderColor} m-3 flex flex-1 flex-col shadow-md`}>
      <div className={`w-52 h-10 top-0 ${bgColor} items-center justify-center flex text-xl font-extrabold `}>{Username}</div>
      <div className={`flex ${(colorCode === 1 || colorCode === 2) ? 'flex-row-reverse' : 'flex-row'} items-center text-center`}>
        <img src={img} alt="Alien" className='' />
        <div className='flex flex-col h-full w-full justify-between p-6'>
          {isBankrupt ? <>
            <span className='text-3xl'>CSŐD</span>
          </>
            : <>
              <Progress color={color} radius="xl" value={Math.min((playerCountdown) ? (remain / 20) * 100 : 0, 100)} striped animate />
              <span className='w-full'>{formatter.format(money)}</span>

            </>
          }
        </div>
      </div>
    </div>
  )
}
