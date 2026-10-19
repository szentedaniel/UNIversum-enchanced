import { Button, Checkbox, createStyles, Group, Image, Modal, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux';
import { GAME_CONFIG } from '../../gameConfig';
import { buyLand, buyMuseum, nextPlayer, payTax, setShowTax, resetCountdown, setShowDoubler, startQuarantine, setShowErasmus, setShowBuyPanel, setShowSell, setSellValue, setShowCard, setSelectedCard } from '../../Store/slices/gameStateSlice';
import calcPrice from '../../Utils/calcPrice';
import checkmark from '../../Images/game/gameicons/PNG/White/1x/checkmark.png'
import unavailable from '../../Images/game/gameicons/PNG/White/1x/locked.png'
import museumPic from '../../Images/game/characters/museum.png'
import adoPic from '../../Images/game/characters/ado2.png'
import formatter from '../../Utils/formatter';
import _ from 'lodash';
import { useSocket } from '../../Contexts/SocketContext';

export default function BuyComponent(props) {
  const [opened, setOpened] = useState(true)
  const [modalTitle, setModalTitle] = useState('Város')
  const [selectedLevel, setSelectedLevel] = useState(null)
  const [sajat, setSajat] = useState(false)
  const [nemSajat, setNemSajat] = useState(false)
  const [museum, setMuseum] = useState(false)
  const [tax, setTax] = useState(false)
  const [alreadyNext, setAlreadyNext] = useState(false)
  const [price, setPrice] = useState({
    toBuy: null,
    tandij: null,
    sellToBank: null,
    sellToPlayer: null
  })
  const { players, currentPlayer, museumPrice, showBuyPanel, fields, RoundOnMe, selectedCard, lastDiceRoll } = props


  const colorCode = players[currentPlayer].colorCode

  const socket = useSocket()
  const dispatch = useDispatch()

  let playerField = players[currentPlayer].field % 32
  if (playerField === 32) playerField = 0

  useEffect(() => {
    const price = calcPrice(playerField, selectedLevel, fields)
    setPrice({
      toBuy: price.toBuy - calcPrice(playerField, fields[playerField].level, fields).toBuy,
      tandij: price.tandij,
      sellToBank: price.sellToBank,
      sellToPlayer: price.sellToPlayer,
    })

    return () => {
      setPrice({
        toBuy: null,
        tandij: null,
        sellToBank: null,
        sellToPlayer: null
      })
    }
  }, [selectedLevel])

  useEffect(() => {
    socket.off('set_selected_card_res').on('set_selected_card_res', data => { dispatch(setSelectedCard(data)) })
  })


  const getCardId = () => {
    const random = Math.floor(Math.random() * GAME_CONFIG.cards.length)
    if (random === selectedCard) return getCardId()
    return random
  }

  useEffect(() => {
    if (showBuyPanel) {
      dispatch(resetCountdown())

      const pricePlusOne = calcPrice(playerField, fields[playerField].level + 1, fields)
      const price = calcPrice(playerField, fields[playerField].level, fields)
      if ((GAME_CONFIG.map[playerField].isNormal) // ha normális mező

      ) {
        if (fields[playerField].level === 4) {
          dispatch(nextPlayer())
        } else {
          if (
            (((currentPlayer === fields[playerField].ownerColor) || (fields[playerField].ownerColor === null)) && (players[currentPlayer].money >= (pricePlusOne.toBuy - price.toBuy))) // ha saját és van pénz fejlesztésre
          ) {

            setSajat(true)
            console.log('ez normal sajat')
            setModalTitle(GAME_CONFIG.map[playerField].label.toUpperCase())
            setOpened(true)
          } else if ((currentPlayer !== fields[playerField].ownerColor) && (players[currentPlayer].money >= ((fields[playerField].level === 0) ? pricePlusOne.sellToPlayer : price.sellToPlayer))) // ha nem saját de van pénz megvenni)
          {
            setNemSajat(true)
            console.log('ez normal nem sajat');

            setModalTitle(GAME_CONFIG.map[playerField].label.toUpperCase())
            setOpened(true)
          } else {
            dispatch(nextPlayer())
            setSelectedLevel(null)
          }
        }
      } else if ((GAME_CONFIG.map[playerField].isMuseum && (fields[playerField].ownerColor === null)) && players[currentPlayer].money >= museumPrice) { // ha múzeum ami nincs megvéve és van rá pénz
        setMuseum(true)
        console.log('ez múzeum ami nincs megvéve');

        setModalTitle(GAME_CONFIG.map[playerField].label.toUpperCase())
        setOpened(true)
      } else if (GAME_CONFIG.map[playerField].isCorner) {
        if (GAME_CONFIG.map[playerField].isQuarantaine) {
          if (!players[currentPlayer].isInQuarantine) {
            dispatch(startQuarantine())
          } else {
            console.log('NEXT step on BÓL', players[currentPlayer].isInQuarantine);

            dispatch(nextPlayer())
          }
        } else if (GAME_CONFIG.map[playerField].isDoubler) {
          let hasFields = fields.filter(x => x.ownerColor !== null)
          hasFields = hasFields.filter(x => x.ownerColor === parseInt(currentPlayer))
          console.log(hasFields);
          console.log('ennyi földede van: ', hasFields.length)
          if (hasFields.length > 0) {
            dispatch(setShowDoubler(true))
          } else { dispatch(nextPlayer()) }
        } else if (GAME_CONFIG.map[playerField].isErasmus) {
          let hasFields = fields.filter(x => x.ownerColor !== null)
          hasFields = hasFields.map(x => x.ownerColor === parseInt(currentPlayer))
          const emptyFields = fields.map(x => x.ownerColor === null)
          if (hasFields.length > 0 || emptyFields.length > 0) {
            dispatch(setShowErasmus(true))
          } else {
            dispatch(nextPlayer())
          }
        } else {  // START
          dispatch(nextPlayer())
        }
      } else if (GAME_CONFIG.map[playerField].isTax) {
        const sajatTulajdon = fields.filter(x => x.ownerColor === currentPlayer)
        const sajatTulajdonErtekei = sajatTulajdon.map(x => calcPrice(x.id, x.level, fields).toBuy)
        const tax = _.sum(sajatTulajdonErtekei) * 0.1
        if (players[currentPlayer].money < tax) {
          dispatch(setShowBuyPanel(false))
          dispatch(resetCountdown())
          dispatch(setShowSell({ value: true, from: 'showBuyPanel' }))
          dispatch(setSellValue(tax - players[currentPlayer].money))
        }
        setTax(true)
        setModalTitle(GAME_CONFIG.map[playerField].label.toUpperCase())
        setOpened(true)
      } else if (GAME_CONFIG.map[playerField].isChance) {
        if (RoundOnMe) {
          const random = getCardId()
          dispatch(setSelectedCard(random))
          dispatch(setShowCard(true))
          socket.emit('set_selected_card_req', random)
        } else {
          dispatch(setShowCard(true))
        }
      } else {
        dispatch(nextPlayer())
        setSelectedLevel(null)
      }
    } else {
      setOpened(false)
      setSelectedLevel(null)
    }

    return () => {
      setSajat(false)
      setNemSajat(false)
      setMuseum(false)
      setTax(false)
      setAlreadyNext(false)

    }
  }, [showBuyPanel])


  const onColseHandler = (e, fromSocket) => {
    if (RoundOnMe) {
      emitBuyComponentClose()
    }
    setOpened(false)
    console.log(socket.id);
    //if (!fromSocket) 

    dispatch(nextPlayer())
    setAlreadyNext(true)
    setSelectedLevel(null)

    // setTimeout(() => {
    // }, 500)
  }

  useEffect(() => {
    socket.off('step_on_field_controller_res').on('step_on_field_controller_res', (id) => {
      console.log(id);
      console.log(socket.id)
      if (id !== socket.id) onColseHandler(null, true)
    })

    return () => {
      // socket.off('step_on_field_controller_res')
    }
  })


  const emitBuyComponentClose = () => {
    socket.emit('step_on_field_controller_req')
  }

  let popupBody = <></>

  if (sajat) {
    popupBody = <BuyComponentSajat RoundOnMe={RoundOnMe} price={price} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} onColseHandler={onColseHandler} />
  } else if (nemSajat) {
    popupBody = <BuyComponentNemSajat RoundOnMe={RoundOnMe} price={price} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} onColseHandler={onColseHandler} />
  } else if (museum) {
    popupBody = <MuseumBuy RoundOnMe={RoundOnMe} playerField={playerField} onColseHandler={onColseHandler} />
  } else if (tax) {
    popupBody = <TaxBody RoundOnMe={RoundOnMe} currentPlayer={currentPlayer} fields={fields} onColseHandler={onColseHandler} />
  }

  return (
    <>{true &&
      <Modal
        size="lg"
        // size="calc(100vw - 20vw)"
        centered
        opened={opened}
        onClose={onColseHandler}
        title={modalTitle}
        transition='slide-up'
        transitionDuration={300}
        transitiontimingfunction='ease'
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={(RoundOnMe ? true : false)}
        radius={'lg'}
        classNames={{ modal: 'bg-[#F5ECE3]' }}
      //overlayColor={'#F5ECE3'}
      >
        <>
          {popupBody}
        </>
      </Modal>
    }
    </>
  )
}




function TaxBody(props) {
  const { onColseHandler, fields, currentPlayer, RoundOnMe } = props
  const dispatch = useDispatch()
  const socket = useSocket()

  useEffect(() => {
    dispatch(setShowTax(true))
    socket.off('tax_res').on('tax_res', () => { closeHandler(null, true) })


    return () => {
      dispatch(setShowTax(false))
      // socket.off('tax_res')
    }
  })



  const sajatTulajdon = fields.filter(x => x.ownerColor === currentPlayer)
  const sajatTulajdonErtekei = sajatTulajdon.map(x => calcPrice(x.id, x.level, fields).toBuy)
  const tax = _.sum(sajatTulajdonErtekei) * 0.1


  const closeHandler = (e, fromSocket) => {
    if (RoundOnMe) emitTax()
    dispatch(payTax())
    dispatch(setShowTax(false))
    if (!fromSocket) onColseHandler()
  }
  const emitTax = () => {
    socket.emit('tax_req')
  }

  return (
    <>

      <div className='flex flex-col justify-center items-center w-auto'>
        <div className='flex flex-col items-center content-center w-32 h-32 rounded m-3 drop-shadow-md'>
          <img src={adoPic} alt="adó" />
        </div>

        <div className='flex flex-col w-4/5 h-32 rounded-lg bg-[#eedac6] self-center items-center justify-evenly mb-3 p-3 leading-5'>
          <span>Ráléptél az ADÓ mezőre </span>
          <p><span>Fizetned kell {formatter(tax)} összeget</span></p>
        </div>
        {RoundOnMe &&
          <div
            onClick={closeHandler}
            className='flex w-32 h-10 bg-orange-300 border-orange-100 border-4 cursor-pointer rounded-full items-center justify-center hover:bg-orange-400 shadow-lg'>Megértettem</div>
        }
      </div>
    </>
  )
}



function MuseumBuy(props) {
  const { onColseHandler, playerField, RoundOnMe } = props
  const { museumPrice } = useSelector((state) => state.gameState)
  const dispatch = useDispatch()
  const socket = useSocket()

  useEffect(() => {
    socket.off('museum_buy_res').on('museum_buy_res', data => {
      console.log('kapott: ', data);
      buy(null, data, true)
    })

    return () => {
      // socket.off('museum_buy_res')
    }
  })


  const buy = (e, field_ = null, fromSocket) => {
    let field = field_
    // console.log(field_);
    if (!field) {
      field = {
        fieldId: playerField
      }
    }
    // console.log(field);
    if (RoundOnMe) emitBuy(e, field)
    dispatch(buyMuseum(field))
    if (!fromSocket) onColseHandler()
  }

  const emitBuy = (e, field) => {
    const data = field
    // console.log(data);
    socket.emit('museum_buy_req', data)
  }

  return (
    <>
      {RoundOnMe &&
        <>
          <div className="flex justify-center space-x-6 w-auto bg-[#F5ECE3]">
            <div
              className={`flex flex-col items-center content-center justify-evenly w-32 h-32 bg-gradient-to-t from-green-300 to-green-100 hover:border-green-300 border-green-300 border-2 rounded m-3 drop-shadow-md`}>
              <img src={museumPic} alt="museumPic" />
              <span className='text-2xl -mt-5'>{'Museum'}</span>
            </div>
          </div>
          <div className='flex flex-col h-full content-evenly items-center'>
            <div
              onClick={buy}
              className=' cursor-pointer rounded-full w-max p-4 bg-green-300 hover:bg-green-400 shadow-md border-green-100 border-4 m-4 text-2xl'> Vásárlás {'( '} {formatter(museumPrice)} {' )'}</div>
            <div>Minden birtokolt múzeum ennyi összeggel növeli a belépési díjat: <span className='font-extrabold'>{formatter(75000)}</span></div>
          </div>
        </>
      }
      {!RoundOnMe &&
        <>
          <div className='flex flex-col h-full content-evenly items-center'>
            <div className='text-2xl '>Más játékos interakciót végez éppen...</div>
          </div>
        </>
      }
    </>
  )
}

function BuyComponentNemSajat(props) {
  const { playerField, fields, setSelectedLevel, selectedLevel, price, onColseHandler, RoundOnMe } = props
  const dispatch = useDispatch()
  const socket = useSocket()

  useEffect(() => {
    socket.off('buy_nem_sajat_res').on('buy_nem_sajat_res', land => {
      console.log('kapott: ', land);
      buy(null, land, true)
    })

    return () => {
      // socket.off('buy_nem_sajat_res')
    }
  })


  const buy = (e, land_ = null, fromSocket) => {
    let land = land_
    // console.log(land_)
    if (!land) {
      land = {
        ar: price.sellToPlayer,
        fieldId: playerField,
        level: selectedLevel
      }
    }
    // console.log(land)
    if (RoundOnMe) emitBuy(e, land)
    dispatch(buyLand(land))
    if (!fromSocket) onColseHandler()
  }

  const emitBuy = (e, land) => {
    const data = land
    // console.log(data);
    socket.emit('buy_nem_sajat_req', data)
  }
  return (
    <>
      {RoundOnMe &&
        <>
          <div className="flex justify-center space-x-6 w-auto bg-[#F5ECE3]">
            <LevelSelector id={1} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} nemSajat />
            <LevelSelector id={2} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} nemSajat />
            <LevelSelector id={3} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} nemSajat />
            <LevelSelector id={4} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} nemSajat />
          </div>
          <div className='flex flex-col h-full content-evenly items-center'>
            <div className='text-2xl '>Tandíj: {formatter(price.tandij)}</div>
            <div
              onClick={buy}
              className=' cursor-pointer rounded-full w-max p-4 bg-green-300 hover:bg-green-400 shadow-md border-green-100 border-4 m-4 text-2xl'> Vásárlás {'( '} {formatter(price.sellToPlayer)} {' )'}</div>
            <div>Más játkosok ennyiért vehetik meg tőled: {formatter(price.sellToPlayer)}</div>
          </div>
        </>
      }
      {!RoundOnMe &&
        <>
          <div className='flex flex-col h-full content-evenly items-center'>
            <div className='text-2xl '>Más játékos interakciót végez éppen...</div>
          </div>
        </>
      }
    </>
  )
}


function BuyComponentSajat(props) {
  const { players, currentPlayer, playerField, fields, setSelectedLevel, selectedLevel, price, onColseHandler, RoundOnMe } = props
  const dispatch = useDispatch()
  const socket = useSocket()

  useEffect(() => {
    socket.off('buy_sajat_res').on('buy_sajat_res', land => {
      console.log('kapott: ', land);
      buy(null, land, true)
    })

    return () => {
      // socket.off('buy_sajat_req')
    }
  })

  const buy = (e, land_ = null, fromSocket) => {
    let land = land_
    // console.log(land_)
    if (!land) {
      land = {
        ar: price.toBuy,
        fieldId: playerField,
        level: selectedLevel
      }
    }
    // console.log(land)

    if (RoundOnMe) emitBuy(e, land)
    dispatch(buyLand(land))
    if (!fromSocket) onColseHandler()
    // setTimeout(() => {
    // }, 400);
  }


  const emitBuy = (e, land) => {
    const data = land
    // console.log(data);
    socket.emit('buy_sajat_req', data)
  }

  return (
    <>{RoundOnMe && <>
      <div className="flex justify-center space-x-6 w-auto bg-[#F5ECE3]">
        <LevelSelector id={1} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} />
        <LevelSelector id={2} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} />
        <LevelSelector id={3} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} />
        <LevelSelector id={4} playerField={playerField} fields={fields} setSelectedLevel={setSelectedLevel} selectedLevel={selectedLevel} players={players} currentPlayer={currentPlayer} />
      </div>
      <div className='flex flex-col h-full content-evenly items-center'>
        <div className='text-2xl '>Tandíj: {formatter(price.tandij)}</div>
        <div
          onClick={buy}
          className=' cursor-pointer rounded-full w-max p-4 bg-green-300 hover:bg-green-400 shadow-md border-green-100 border-4 m-4 text-2xl'> Vásárlás {'( '} {formatter(price.toBuy)} {' )'}</div>
        <div>Más játkosok ennyiért vehetik meg tőled: {formatter(price.sellToPlayer)}</div>
      </div>
    </>
    }
      {!RoundOnMe &&
        <>
          <div className='flex flex-col h-full content-evenly items-center'>
            <div className='text-2xl '>Más játékos interakciót végez éppen...</div>
          </div>
        </>
      }
    </>
  )
}


function LevelSelector(props) {
  const { players, currentPlayer, id, setSelectedLevel, selectedLevel, playerField, fields, nemSajat } = props


  const price = {
    toBuy: calcPrice(playerField, id, fields).toBuy - calcPrice(playerField, fields[playerField].level, fields).toBuy,
    // tandij: calcPrice(playerField, id, fields).tandij,
    // sellToBank: calcPrice(playerField, id, fields).sellToBank,
    // sellToPlayer: calcPrice(playerField, id, fields).sellToPlayer,
  }


  const buyed = (fields[playerField].level >= id) ? true : false

  let available = true
  if (nemSajat) {
    available = id === fields[playerField].level
  } else {
    if (id === 4) {
      available = ((id === 4) && (fields[playerField].level === 3))
    } else {
      available = price.toBuy <= players[currentPlayer].money
    }
  }

  useEffect(() => {
    if (selectedLevel === null)
      if (nemSajat) {
        setSelectedLevel(fields[playerField].level)
      } else setSelectedLevel(fields[playerField].level + 1)
    return () => {
      setSelectedLevel(null)
    }
  }, [])


  const handleClick = () => {
    if (buyed) {
      setSelectedLevel(fields[playerField].level + 1)
    } else if (!available) {

    } else {
      setSelectedLevel(id)
    }
  }
  return (
    <>
      {nemSajat ?
        <>
          {id === fields[playerField].level &&
            <div
              onClick={handleClick}
              className={`flex flex-col items-center content-center justify-evenly w-32 h-32  ${(id <= selectedLevel) ? 'bg-gradient-to-t from-orange-300 to-orange-100 hover:border-orange-300 border-orange-300 border-2' : 'bg-gradient-to-t from-green-300 to-green-100 hover:border-green-300 border-green-300 border-2'} rounded m-3 drop-shadow-md`}>
              <span className='text-3xl'>{id}</span>
              <span className=''>emelet</span>
            </div>
          }
        </>
        :
        <div
          onClick={handleClick}
          className={`flex flex-col items-center content-center justify-evenly w-32 h-32  ${!buyed ? (available ? ((id <= selectedLevel) ? 'bg-gradient-to-t from-orange-300 to-orange-100 hover:border-orange-300 border-orange-300 border-2' : 'bg-gradient-to-t from-green-300 to-green-100 hover:border-green-300 border-green-300 border-2') : 'bg-gray-400 border-4 border-gray-400') : 'bg-green-400 border-4 border-green-400'} rounded m-3 drop-shadow-md`}>
          <span className='text-3xl'>{id}</span>
          <span className=''>emelet</span>
          {buyed && <img src={checkmark} alt="checkmark" className='absolute' />}
          {!available && <img src={unavailable} alt="unavailable" className='absolute' />}
        </div>
      }
    </>
  )
}

