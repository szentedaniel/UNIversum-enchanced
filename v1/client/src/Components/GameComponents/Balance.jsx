import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { minusTandij, setShowBalance, setShowBuyPanel, setShowSell, setSellValue, resetCountdown, setBankrupt, nextPlayer } from '../../Store/slices/gameStateSlice'
import calcPrice from '../../Utils/calcPrice'
import { formatter } from '../../Utils/formatter'
import _ from 'lodash';

export default function Balance(props) {
  const { currentPlayer, fields, players, showBalance, RoundOnMe } = props
  const [mine, setMine] = useState(false)
  const [show, setShow] = useState(false)
  const [tandij, setTandij] = useState(0)

  const dispatch = useDispatch()



  let playerField = players[currentPlayer].field % 32
  if (playerField === 32) playerField = 0
  useEffect(() => {
    if (showBalance) {

      if (fields[playerField].ownerColor !== null) {

        if (currentPlayer === fields[playerField].ownerColor) {
          setMine(true)
          dispatch(setShowBalance(false))
          dispatch(setShowBuyPanel(true))
        } else {
          const temp_tandij = calcPrice(playerField, fields[playerField].level, fields).tandij
          setTandij(temp_tandij)
          setMine(false)
          if (players[currentPlayer].money < temp_tandij) {
            const sajatTulajdon = fields.filter(x => x.ownerColor === currentPlayer)
            const sajatTulajdonErtekei = sajatTulajdon.map(x => calcPrice(x.id, x.level, fields).toBuy)
            const ertek = _.sum(sajatTulajdonErtekei)
            if (ertek < temp_tandij) {
              dispatch(setBankrupt())
              dispatch(nextPlayer())
            } else {
              dispatch(setShowBalance(false))
              dispatch(resetCountdown())
              dispatch(setShowSell({ value: true, from: 'showBalance' }))
              dispatch(setSellValue(temp_tandij - players[currentPlayer].money))
            }
          } else {
            setShow(true)
            dispatch(minusTandij({ tandij: temp_tandij, fieldId: playerField }))

            setTimeout(() => {
              setShow(false)
              setTimeout(() => {
                dispatch(setShowBalance(false))
                dispatch(setShowBuyPanel(true))
              }, 300);
            }, 3000);
          }
        }

        return () => {
          setMine(false)
        }
      } else {
        dispatch(setShowBalance(false))
        dispatch(setShowBuyPanel(true))
      }
    }
  }, [showBalance])

  return (
    <>
      {show && <div className={`absolute transition-all ease-in-out duration-300 ${show ? 'opacity-100' : 'opacity-0'}`}>
        <span className='text-6xl font-sigmar-one'>
          {'-' + formatter(tandij)}
        </span>
      </div>}
    </>
  )
}
