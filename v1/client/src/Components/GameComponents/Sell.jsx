import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { resetCountdown, setShowSell, sellSelectedFields, autoSellSelectedFields } from '../../Store/slices/gameStateSlice'
import calcPrice from '../../Utils/calcPrice'
import _ from 'lodash';
import { useSocket } from '../../Contexts/SocketContext';

export default function Sell(props) {
  const { showSell, sellValue, selectedFields, map: fields } = useSelector((state) => state.gameState)
  const dispatch = useDispatch()
  const [showLabel, setShowLabel] = useState(showSell)
  const [selectedValue, setSelectedValue] = useState(0)
  const [sellable, setSellable] = useState(false)
  const { RoundOnMe } = props
  const socket = useSocket()

  const formater = new Intl.NumberFormat('en-GB', { notation: 'compact' })

  useEffect(() => {
    socket.off('on_autoSell_handler_res').on('on_autoSell_handler_res', id => { if (id !== socket.id) onAutoSellHandler() })
    socket.off('on_sell_handler_res').on('on_sell_handler_res', id => { if (id !== socket.id) onSellHandler() })
  })

  useEffect(() => {
    if (showSell) {
      setShowLabel(true)
    } else {
      setShowLabel(false)
      setSellable(false)
    }
    dispatch(resetCountdown())
  }, [showSell])

  useEffect(() => {
    const fieldsValue = _.sum(selectedFields.map(x => calcPrice(x, fields[x].level, fields).sellToBank))
    setSelectedValue(fieldsValue)
    setSellable(parseInt(fieldsValue) >= parseInt(sellValue))
  }, [selectedFields])


  const onSellHandler = () => {
    if (sellable) {
      if (RoundOnMe) emitOnSellHandler()
      setShowLabel(false)
      dispatch(resetCountdown())
      dispatch(sellSelectedFields())

      setTimeout(() => {
        dispatch(setShowSell({ value: false, from: '' }))
      }, 400);
    }
  }
  const emitOnSellHandler = () => {
    socket.emit('on_sell_handler_req')
  }

  const onAutoSellHandler = () => {
    if (RoundOnMe) emitOnAutoSellHandler()
    setShowLabel(false)
    dispatch(resetCountdown())
    dispatch(autoSellSelectedFields())

    setTimeout(() => {
      dispatch(setShowSell({ value: false, from: '' }))
    }, 400);
  }
  const emitOnAutoSellHandler = () => {
    socket.emit('on_autoSell_handler_req')
  }

  return (
    <>
      {showLabel &&
        <div className={`absolute flex flex-col items-center transition-all ease-in-out duration-300 ${showLabel ? 'opacity-100' : 'opacity-0'}`}>
          <span className='text-3xl font-sigmar-one'>
            {'Válaszd ki a mezőket'}
          </span>
          <div className={`flex items-center justify-center h-12 w-44 ${sellable && selectedValue !== 0 ? 'bg-green-400 border-green-100' : 'bg-red-500 border-red-100'} border-4 rounded-lg mt-4 mb-2 shadow-md`}>
            <span className={`text-center text-red-50`}>{formater.format(selectedValue) + ' / ' + formater.format(sellValue)}</span>
          </div>
          <div className='flex flex-row space-x-5 items-center justify-center'>
            {RoundOnMe && <>
              <div onClick={onSellHandler} className={`flex items-center w-fit h-12 py-2 px-4 ${sellable && selectedValue !== 0 ? 'bg-green-400 hover:bg-green-500 border-green-100 cursor-pointer' : 'bg-gray-400 border-gray-100 cursor-not-allowed'} rounded-full border-4 shadow-md text-lg `}>{'Eladás'.toUpperCase()}</div>
              <div onClick={onAutoSellHandler} className={`flex items-center w-fit h-12 py-2 px-4 bg-orange-400 hover:bg-orange-500 border-orange-100 cursor-pointer rounded-full border-4 shadow-md text-md `}>{'Automatikus'.toUpperCase()}</div>
            </>
            }
          </div>
        </div>
      }
    </>
  )
}
