import { createSlice } from '@reduxjs/toolkit'
import calcPrice from '../../Utils/calcPrice'
import * as _ from 'lodash'
import { GAME_CONFIG } from '../../gameConfig'
import { join } from 'lodash'

const end = new Date(new Date().getTime() + 50 * 60000).toISOString()

const initState = {
  roomCode: null,
  isLoaded: false,
  currentPlayer: 0,
  showDiceRoll: true,
  showBalance: false,
  showBuyPanel: false,
  showFirstQuarantineTab: false,
  showQuarantineTab: false,
  rollingDiceFromQuarantine: false,
  showDoubler: false,
  selectDoubler: false,
  showErasmus: false,
  selectErasmus: false,
  showDisabledFields: false,
  singleSelecting: false,
  multipleSelecting: false,
  onlyOwnField: false,
  selectedFields: [],
  showSell: false,
  showTax: false,
  sellValue: 0,
  sellIsFrom: '',
  lastDiceRoll: 0,
  museumPrice: 400_000,
  roundBonus: 250_000,
  resetCountdown: 1,
  currentPlayerIndex: 0,
  gameOver: false,
  winnerColor: null,
  endDate: end,
  selectedCard: 0,
  showCard: false,
  players: [
    {
      username: 'user' + Math.floor(Math.random() * 999999),
      userId: null,
      colorCode: 0,
      money: 2_500_000,
      hasPCR: false,
      coutPCR: 0,
      isInQuarantine: false,
      QuarantineRounds: 0,
      field: 0,
      timeRemain: 0,
      playerCountdown: true,
      isBankrupt: false

    },
    {
      username: 'user' + Math.floor(Math.random() * 999999),
      userId: null,
      colorCode: 1,
      money: 2_500_000,
      hasPCR: false,
      coutPCR: 0,
      isInQuarantine: false,
      QuarantineRounds: 0,
      field: 0,
      timeRemain: 0,
      playerCountdown: false,
      isBankrupt: false
    },
    {
      username: 'user' + Math.floor(Math.random() * 999999),
      userId: null,
      colorCode: 2,
      money: 2_500_000,
      hasPCR: false,
      coutPCR: 0,
      isInQuarantine: false,
      QuarantineRounds: 0,
      field: 0,
      timeRemain: 0,
      playerCountdown: false,
      isBankrupt: false
    },
    {
      username: 'user' + Math.floor(Math.random() * 999999),
      userId: null,
      colorCode: 3,
      money: 2_500_000,
      hasPCR: false,
      coutPCR: 0,
      isInQuarantine: false,
      QuarantineRounds: 0,
      field: 0,
      timeRemain: 0,
      playerCountdown: false,
      isBankrupt: false
    },

  ],
  map: [
    {
      id: 0,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 1,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 2,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 3,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 4,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 5,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 6,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 7,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 8,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 9,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 10,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 11,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 12,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 13,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 14,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 15,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 16,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 17,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 18,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 19,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 20,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 21,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 22,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 23,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 24,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 25,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 26,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 27,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 28,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 29,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 30,
      level: null,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
    {
      id: 31,
      level: 0,
      ownerColor: null,
      hasDoubler: false,
      doublerCount: 0
    },
  ],
}

export const gameStateSlice = createSlice({
  name: 'gameState',
  initialState: {
    roomCode: null,
    isLoaded: false,
    currentPlayer: 0,
    showDiceRoll: true,
    showBalance: false,
    showBuyPanel: false,
    showFirstQuarantineTab: false,
    showQuarantineTab: false,
    rollingDiceFromQuarantine: false,
    showDoubler: false,
    selectDoubler: false,
    showErasmus: false,
    selectErasmus: false,
    showDisabledFields: false,
    singleSelecting: false,
    multipleSelecting: false,
    onlyOwnField: false,
    selectedFields: [],
    showSell: false,
    showTax: false,
    sellValue: 0,
    sellIsFrom: '',
    lastDiceRoll: 0,
    museumPrice: 400_000,
    roundBonus: 250_000,
    resetCountdown: 1,
    currentPlayerIndex: 0,
    gameOver: false,
    winnerColor: null,
    endDate: end,
    selectedCard: 0,
    showCard: false,
    players: [
      {
        username: 'user' + Math.floor(Math.random() * 999999),
        userId: null,
        colorCode: 0,
        money: 2_500_000,
        hasPCR: false,
        coutPCR: 0,
        isInQuarantine: false,
        QuarantineRounds: 0,
        field: 0,
        timeRemain: 0,
        playerCountdown: true,
        isBankrupt: false

      },
      {
        username: 'user' + Math.floor(Math.random() * 999999),
        userId: null,
        colorCode: 1,
        money: 2_500_000,
        hasPCR: false,
        coutPCR: 0,
        isInQuarantine: false,
        QuarantineRounds: 0,
        field: 0,
        timeRemain: 0,
        playerCountdown: false,
        isBankrupt: false
      },
      {
        username: 'user' + Math.floor(Math.random() * 999999),
        userId: null,
        colorCode: 2,
        money: 2_500_000,
        hasPCR: false,
        coutPCR: 0,
        isInQuarantine: false,
        QuarantineRounds: 0,
        field: 0,
        timeRemain: 0,
        playerCountdown: false,
        isBankrupt: false
      },
      {
        username: 'user' + Math.floor(Math.random() * 999999),
        userId: null,
        colorCode: 3,
        money: 2_500_000,
        hasPCR: false,
        coutPCR: 0,
        isInQuarantine: false,
        QuarantineRounds: 0,
        field: 0,
        timeRemain: 0,
        playerCountdown: false,
        isBankrupt: false
      },

    ],
    map: [
      {
        id: 0,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 1,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 2,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 3,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 4,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 5,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 6,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 7,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 8,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 9,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 10,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 11,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 12,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 13,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 14,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 15,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 16,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 17,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 18,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 19,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 20,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 21,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 22,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 23,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 24,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 25,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 26,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 27,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 28,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 29,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 30,
        level: null,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
      {
        id: 31,
        level: 0,
        ownerColor: null,
        hasDoubler: false,
        doublerCount: 0
      },
    ],
  },
  reducers: {

    setShowDiceRoll: (state, action) => {
      state.showDiceRoll = action.payload
    },
    setDiceRollValue: (state, action) => {
      state.lastDiceRoll = action.payload
      state.players[state.currentPlayer].field += action.payload
    },
    nextPlayer: (state) => {
      try {
        state.players[state.currentPlayer].playerCountdown = false
        state.showFirstQuarantineTab = false
        state.showQuarantineTab = false
        state.showBuyPanel = false
        state.selectedFields = []
        state.showDoubler = false
        state.selectDoubler = false
        state.showDisabledFields = false
        state.singleSelecting = false
        state.onlyOwnField = false
        state.selectErasmus = false
        state.showErasmus = false
        state.showBalance = false

        setShowQuarantineTab(state, false)



        // if (state.currentPlayer === state.players.length - 1) {
        //   state.currentPlayer = 0
        // } else state.currentPlayer = state.currentPlayer + 1

        const findValidNextPlayer = () => {
          const validPlayers = state.players.filter(x => x.isBankrupt === false)
          // validPlayers.forEach(element => {
          //   // console.log('lehetID: ', element.colorCode);
          // });
          if (validPlayers.length > 1) {

            // console.log('current', state.currentPlayerIndex);
            if (state.currentPlayerIndex >= validPlayers.length - 1 || state.currentPlayerIndex < 0) {
              // console.log('logika', state.currentPlayerIndex >= validPlayers.length - 1);
              state.currentPlayerIndex = 0
            } else state.currentPlayerIndex += 1
            // console.log(validPlayers[state.currentPlayerIndex].colorCode);
            return validPlayers[state.currentPlayerIndex].colorCode
          }
          return -1
        }
        const getOccurrence = (array, value) => {
          var count = 0;
          array.forEach((v) => (v === value && count++));
          return count;
        }

        const gameOverCheck = () => {
          // ha megvan véve mind a 4 museum ugyanattol az embertol
          const museums = GAME_CONFIG.map.filter(x => x.isMuseum)
          const museumIds = museums.map(x => x.id)
          const jelenlegiMuseums = state.map.filter(x => museumIds.includes(x.id))
          let jelenlegiOwnerColors = jelenlegiMuseums.filter(x => x !== null)
          jelenlegiOwnerColors = jelenlegiOwnerColors.map(x => parseInt(x.ownerColor))
          let supermonopol = false
          if (jelenlegiOwnerColors.length > 0) {
            supermonopol = jelenlegiOwnerColors.every((val, ind, arr) => val === arr[0])
            if (supermonopol) state.winnerColor = jelenlegiOwnerColors[0]
          }

          // ha valaki birtokol 3 monopoliumot
          let hasThreeMonopol = false
          try {
            let groupIds = GAME_CONFIG.map.map(x => x.groupId)
            groupIds = _.uniq(groupIds)
            groupIds = _.remove(groupIds, ((x) => x !== 0))

            let monopolTulajokColorja = groupIds.map(groupId => {
              const CsoportbanLevoMezokIdja = GAME_CONFIG.map.map(x => {
                if (x.groupId === groupId && x.id) {
                  return x.id
                }
              })

              let csoportTulajainakSzine = state.map.map(x => {
                if (CsoportbanLevoMezokIdja.includes(x.id)) {
                  return x.ownerColor
                }
                return null
              })

              csoportTulajainakSzine = csoportTulajainakSzine.filter(x => { return x !== null })

              // const occurrences = csoportTulajainakSzine.reduce(function (acc, curr) {
              //   return acc[curr] ? ++acc[curr] : acc[curr] = 1, acc
              // }, {})

              let ugyanaz = false
              if (csoportTulajainakSzine.length === GAME_CONFIG.map.filter(x => x.groupId === groupId).length) {
                ugyanaz = csoportTulajainakSzine.every((val, ind, arr) => val === arr[0])
              }

              // console.log('csoport tulajainak szinei: ', join(csoportTulajainakSzine), ugyanaz)
              // console.log('csoport tulajainak szineienk előfurdulása: ', join(occurrences))
              if (ugyanaz) return csoportTulajainakSzine[0]

              let monopolE = false
              let tulajSzine = null

              for (let i = 0; i < csoportTulajainakSzine.length; i++) {
                const element = csoportTulajainakSzine[i];

                // if (occurrences[element] === CsoportbanLevoMezokIdja.length) {
                //   monopolE = true
                //   tulajSzine = element
                // }
              }
              // csoportTulajainakSzine.forEach(element => {
              //   // console.log('groupId: ', groupId, 'tulajszin: ', element);
              // });
              // // // // const monopolE = csoportTulajainakSzine.every((val, ind, arr) => val === arr[0])
              // console.log(monopolE);

              if (monopolE) return tulajSzine // csoportTulajainakSzine[0]

              return null

            });
            // console.log('ehhh:');
            monopolTulajokColorja = monopolTulajokColorja.map(x => x)
            monopolTulajokColorja = monopolTulajokColorja.filter(x => x !== null)
            // monopolTulajokColorja.forEach(element => {
            //   // console.log(element);
            // });
            // const monopolGroupsTulajdonosok = groupIds.map(x => {
            //   const groupId = x

            //   const jelenlegiCsoport = GAME_CONFIG.map.filter(mezo => mezo.groupId === groupId) //jelenlegi csoport id

            //   const csoportTulajainakId = jelenlegiCsoport.map(x => x.ownerColor)
            //   const monopolE = csoportTulajainakId.every((val, ind, arr) => val === arr[0])
            //   if (monopolE) return csoportTulajainakId[0]
            // })
            // console.log(join(monopolTulajokColorja))

            const validPlayers = state.players.filter(x => x.isBankrupt === false)
            const validPlayersIds = validPlayers.map(x => x.colorCode)

            for (let i = 0; i < validPlayersIds.length; i++) {
              const element = validPlayersIds[i];
              if (getOccurrence(monopolTulajokColorja, element) >= 3) {
                hasThreeMonopol = true
                state.winnerColor = element
              }

            }
          } catch (error) {
            // console.log(error)
          }



          // van e elég játékos
          const validPlayers = state.players.filter(x => x.isBankrupt === false)



          // console.log('ido: ', new Date().getTime() >= new Date(state.endDate).getTime());
          // return logika
          if (validPlayers.length <= 1) {
            const winner = _.orderBy(validPlayers, ['money'], ['desc'])
            state.winnerColor = winner[0].colorCode
            // console.log('nincs tobb player');
            return true
          } else if (new Date().getTime() >= new Date(state.endDate).getTime()) {
            const vagyon = state.players.map(x => {
              const fieldValue = _.sum(state.map.filter(field => field.ownerColor === x.colorCode))
              const tulajdon = fieldValue + x.money
              return {
                colorCode: x.colorCode,
                vagyon: tulajdon
              }
            })
            const winner = _.orderBy(vagyon, ['vagyon'], ['desc'])
            state.winnerColor = winner[0].colorCode
            // console.log('lejart az ido');
            return true
          } else if (supermonopol) {
            // console.log('supermonopol');
            return true
          } else if (hasThreeMonopol) {
            // console.log('3 monopol');
            return true
          } else return false
        }




        if (gameOverCheck()) {
          state.gameOver = true
          // console.log('vege');
          state.showDiceRoll = false
        }
        else {
          state.currentPlayer = findValidNextPlayer()




          if (state.players[state.currentPlayer].isInQuarantine) {
            if (state.players[state.currentPlayer].QuarantineRounds === 0) {

              state.players[state.currentPlayer].isInQuarantine = false
              state.showDiceRoll = true
            } else {
              state.showQuarantineTab = false
              state.showQuarantineTab = true
            }
          } else {
            state.showDiceRoll = true
          }

          state.players[state.currentPlayer].playerCountdown = true
        }
      } catch (error) {
        // console.log(error);
      }
    },
    setShowBuyPanel: (state, action) => {
      state.showBuyPanel = action.payload
    },
    setShowBalance: (state, action) => {
      state.showBalance = action.payload
    },
    minusTandij: (state, action) => {
      if (state.players[state.currentPlayer].money < action.payload.tandij) {
        // ha kevesebb a pénz mint kéne
      }
      state.players[state.currentPlayer].money -= action.payload.tandij
      const fieldId = action.payload.fieldId
      state.players[state.map[fieldId].ownerColor].money += action.payload.tandij

      setTimeout(() => {
        setShowBalance(state, false)
        setShowBuyPanel(state, true)
      }, 3300);
    },
    buyLand: (state, action) => {
      const { ar, fieldId, level } = action.payload
      const owner = state.map[fieldId].ownerColor


      state.players[state.currentPlayer].money = state.players[state.currentPlayer].money - ar
      if (owner) {
        state.players[owner].money = state.players[owner].money + ar
      }
      state.map[fieldId].ownerColor = state.currentPlayer
      state.map[fieldId].level = level

      nextPlayer(state)
    },
    buyMuseum: (state, action) => {
      const { fieldId } = action.payload

      state.players[state.currentPlayer].money = state.players[state.currentPlayer].money - state.museumPrice

      state.map[fieldId].ownerColor = state.currentPlayer
      state.map[fieldId].level = 1

      setTimeout(() => {
        nextPlayer(state)
      }, 400);
    },
    giveRoundBonus: (state) => {
      state.players[state.currentPlayer].money += state.roundBonus
    },
    resetCountdown: (state) => {
      state.resetCountdown += 1
    },
    payTax: (state) => {
      const sajatTulajdon = state.map.filter(x => x.ownerColor === state.currentPlayer)
      const sajatTulajdonErtekei = sajatTulajdon.map(x => calcPrice(x.id, x.level, state.map).toBuy)
      const tax = _.sum(sajatTulajdonErtekei)
      if (state.players[state.currentPlayer].money < tax * 0.1) {
        // ha kevesebb a pénz mint kéne
      }
      state.players[state.currentPlayer].money -= tax * 0.1
    },
    setShowFirstQuarantineTab: (state, action) => {
      state.showFirstQuarantineTab = action.payload
    },
    setShowQuarantineTab: (state, action) => {
      state.showQuarantineTab = action.payload
    },
    startQuarantine: (state) => {
      state.players[state.currentPlayer].isInQuarantine = true
      state.players[state.currentPlayer].QuarantineRounds = 3
      state.showFirstQuarantineTab = true
    },
    buyPCR: (state) => {
      state.players[state.currentPlayer].money -= 200_000
    },
    setRollingDiceFromQuarantine: (state, action) => {
      state.rollingDiceFromQuarantine = action.payload
    },
    QuarantineRoundsDowner: (state, action) => {
      if (action.payload === 12) {
        state.players[state.currentPlayer].isInQuarantine = false
        state.players[state.currentPlayer].QuarantineRounds = 0
      } else {
        state.players[state.currentPlayer].QuarantineRounds -= 1
      }
    },
    removePCR: (state) => {
      state.players[state.currentPlayer].hasPCR = false
    },
    addSelection: (state, action) => {
      if (!state.selectedFields.includes(action.payload)) {
        state.selectedFields.push(action.payload)
      } else {
        _.remove(state.selectedFields, (n) => action.payload === n)
      }
    },
    putDoublerTo: (state, action) => {
      try {

        // console.log('putDoublerTo ', action.payload);
        const fieldWithDoublerOnIt = state.map.filter(x => x.hasDoubler)

        let same = false
        if (fieldWithDoublerOnIt.length > 0) {
          same = ((fieldWithDoublerOnIt[0].ownerColor === state.currentPlayer) && fieldWithDoublerOnIt[0].id === action.payload)
          if (same) {
            fieldWithDoublerOnIt[0].doublerCount += 1
          } else {
            fieldWithDoublerOnIt[0].hasDoubler = false
            fieldWithDoublerOnIt[0].doublerCount = 0
            state.map[action.payload].hasDoubler = true
            state.map[action.payload].doublerCount += 1
          }
        } else {
          state.map[action.payload].hasDoubler = true
          state.map[action.payload].doublerCount += 1
        }

        state.showDoubler = false
        state.selectDoubler = false
        state.showDisabledFields = false
        state.singleSelecting = false
        state.onlyOwnField = false

      } catch (error) {
        // console.log(error);
      }
    },
    setShowDoubler: (state, action) => {
      state.showDoubler = action.payload
    },
    setSelectDoubler: (state, action) => {
      state.selectDoubler = action.payload
      state.showDisabledFields = action.payload
      state.singleSelecting = action.payload
      state.onlyOwnField = action.payload
    },
    setShowErasmus: (state, action) => {
      state.showErasmus = action.payload
    },
    setSelectErasmus: (state, action) => {
      state.selectErasmus = action.payload
      state.showDisabledFields = action.payload
      state.singleSelecting = action.payload
    },
    setField: (state, action) => {
      state.players[state.currentPlayer].field = action.payload
    },
    setBankrupt: (state) => {
      state.currentPlayerIndex -= 1
      let fieldIdAminAll = state.players[state.currentPlayer].field % 32
      if (fieldIdAminAll === 32) fieldIdAminAll = 0
      // console.log('fieldIdAminAll', fieldIdAminAll);
      const AkinekAFieldjenAllok = state.map[fieldIdAminAll].ownerColor
      // console.log('AkinekAFieldjenAllok', AkinekAFieldjenAllok);
      if (AkinekAFieldjenAllok !== null) {
        state.players[AkinekAFieldjenAllok].money += calcPrice(fieldIdAminAll, state.map[fieldIdAminAll].level, state.map).tandij
      }

      state.players[state.currentPlayer].isBankrupt = true

      const fields = state.map.filter(x => x.ownerColor === state.currentPlayer)
      for (let i = 0; i < fields.length; i++) {
        state.map[fields[i].id].ownerColor = null
        state.map[fields[i].id].hasDoubler = false
        state.map[fields[i].id].doublerCount = 0
        state.map[fields[i].id].level = 0
      }
    },
    setShowSell: (state, action) => {
      state.showSell = action.payload.value
      state.showDisabledFields = action.payload.value
      state.multipleSelecting = action.payload.value
      state.onlyOwnField = action.payload.value
      state.sellIsFrom = action.payload.from
    },
    setSellValue: (state, action) => {
      state.sellValue = action.payload
    },
    sellSelectedFields: (state, action) => {
      state.players[state.currentPlayer].money += _.sum(state.selectedFields.map(x => calcPrice(x, state.map[x].level, state.map).sellToBank))
      const selectedFields = state.selectedFields
      for (let i = 0; i < selectedFields.length; i++) {
        state.map[selectedFields[i]].ownerColor = null
        state.map[selectedFields[i]].hasDoubler = false
        state.map[selectedFields[i]].doublerCount = 0
        state.map[selectedFields[i]].level = 0
      }

      state.selectedFields = []


      if (state.sellIsFrom === 'showBalance') {
        state.showBalance = true
      } else if (state.sellIsFrom === 'showBuyPanel') {
        state.showBuyPanel = true
      } else if (state.sellIsFrom === 'chanceCard') {
        state.players[state.currentPlayer].money -= state.sellValue
        state.sellValue = 0
      }

      state.sellIsFrom = ''
    },
    autoSellSelectedFields: (state, action) => {
      const show = (playerFields, ehh = false) => {
        for (let i = 0; i < playerFields.length; i++) {
          // console.log('id: ', playerFields[i].id)
          // console.log('level: ', playerFields[i].level)
          // console.log('ownerColor: ', playerFields[i].ownerColor)
          // console.log('hasDoubler: ', playerFields[i].hasDoubler)
          // console.log('doublerCount: ', playerFields[i].doublerCount)
          // if (ehh) // console.log('value: ', playerFields[i].value)
          // console.log('\n')

        }
      }
      const calcTheSellingIds = (state, playerFields) => {
        let values = [0]
        let ids = []
        let index = 0

        // console.log(_.sum(values));
        // console.log(state.sellValue);
        while (_.sum(values) <= state.sellValue) {
          values.push(playerFields[index].value)
          ids.push(playerFields[index].id)
          index++
        }
        return { ids: ids, values: values }
      }

      let playerFields = state.map.filter(x => x.ownerColor === state.currentPlayer)
      playerFields = playerFields.map(x => {
        let obj = x
        obj.value = calcPrice(x.id, x.level, state.map).sellToBank
        return obj
      })
      playerFields = _.orderBy(playerFields, ['value'], ['asc'])
      show(playerFields, true)
      const potencialSell = calcTheSellingIds(state, playerFields)
      // console.log('Kell: ', state.sellValue);
      // console.log('potenciális: ', _.sum(potencialSell.values));
      // console.log('potenciálisID: ', potencialSell.ids);

      state.players[state.currentPlayer].money += _.sum(potencialSell.values)

      for (let i = 0; i < potencialSell.ids.length; i++) {
        state.map[potencialSell.ids[i]].ownerColor = null
        state.map[potencialSell.ids[i]].hasDoubler = false
        state.map[potencialSell.ids[i]].doublerCount = 0
        state.map[potencialSell.ids[i]].level = 0
      }
      if (state.sellIsFrom === 'showBalance') {
        state.showBalance = true
      } else if (state.sellIsFrom === 'showBuyPanel') {
        state.showBuyPanel = true
      }

      state.sellIsFrom = ''
    },
    setShowTax: (state, action) => {
      state.showTax = action.payload
    },
    doPunishment: (state, action) => {
      const money = state.players[state.currentPlayer].money
      if (money <= 100_000) {

        const calcTheSellingIds = (state, playerFields) => {
          let values = [0]
          let ids = []
          let index = 0

          while (_.sum(values) <= 100_000) {
            values.push(playerFields[index].value)
            ids.push(playerFields[index].id)
            index++
          }
          return { ids: ids, values: values }
        }

        let playerFields = state.map.filter(x => x.ownerColor === state.currentPlayer)
        if (playerFields.length > 0) { // Ha van mező akkor elad
          playerFields = playerFields.map(x => {
            let obj = x
            obj.value = calcPrice(x.id, x.level, state.map).sellToBank
            return obj
          })
          playerFields = _.orderBy(playerFields, ['value'], ['asc'])
          const potencialSell = calcTheSellingIds(state, playerFields)
          // console.log('Kell: ', state.sellValue);
          // console.log('potenciális: ', _.sum(potencialSell.values));
          // console.log('potenciálisID: ', potencialSell.ids);

          state.players[state.currentPlayer].money += _.sum(potencialSell.values) - 100_000

          for (let i = 0; i < potencialSell.ids.length; i++) {
            state.map[potencialSell.ids[i]].ownerColor = null
            state.map[potencialSell.ids[i]].hasDoubler = false
            state.map[potencialSell.ids[i]].doublerCount = 0
            state.map[potencialSell.ids[i]].level = 0
          }
        } else { // máskülönben csőd
          state.currentPlayerIndex -= 1
          state.players[state.currentPlayer].money = 0
          state.players[state.currentPlayer].isBankrupt = true
          const fields = state.map.filter(x => x.ownerColor === state.currentPlayer)
          for (let i = 0; i < fields.length; i++) {
            state.map[fields[i].id].ownerColor = null
            state.map[fields[i].id].hasDoubler = false
            state.map[fields[i].id].doublerCount = 0
            state.map[fields[i].id].level = 0
          }
        }
      } else {
        state.players[state.currentPlayer].money -= Math.round(state.players[state.currentPlayer].money * 0.1)
      }
    },
    setShowCard: (state, action) => {
      // const getCardId = () => {
      //   const random = Math.floor(Math.random() * GAME_CONFIG.cards.length)
      //   if (random === state.selectedCard) return getCardId()
      //   return random
      // }

      // if (action.payload) {
      //   state.selectedCard = getCardId()
      // }

      state.showCard = action.payload
    },
    applyCardEffect: (state) => {
      state.resetCountdown += 1
      const card = GAME_CONFIG.cards[state.selectedCard]
      if (card.PCR) { // ha PCR akkor odaadja
        state.players[state.currentPlayer].hasPCR = true
      } else if (card.money) {
        if (state.players[state.currentPlayer].money + card.moneyValue >= 0) { // ha van pénz levonja
          state.players[state.currentPlayer].money += card.moneyValue
        } else {
          const sajatTulajdon = state.map.filter(x => x.ownerColor === state.currentPlayer)
          const sajatTulajdonErtekei = sajatTulajdon.map(x => calcPrice(x.id, x.level, state.map).sellToBank)
          const vagyon = _.sum(sajatTulajdonErtekei) + state.players[state.currentPlayer].money
          if (vagyon + card.moneyValue >= 0) { // ha nincs elég pénz de vagyon igen
            // state.showSell = true
            // state.showDisabledFields = true
            // state.multipleSelecting = true
            // state.onlyOwnField = true
            // state.sellIsFrom = 'chanceCard'
            // state.sellValue = Math.abs(vagyon + card.moneyValue)

            const calcTheSellingIds = (playerFields) => {
              let values = [0]
              let ids = []
              let index = 0

              while (_.sum(values) <= state.sellValue) {
                values.push(playerFields[index].value)
                ids.push(playerFields[index].id)
                index++
              }
              return { ids: ids, values: values }
            }

            let playerFields = state.map.filter(x => x.ownerColor === state.currentPlayer)

            playerFields = playerFields.map(x => {
              let obj = x
              obj.value = calcPrice(x.id, x.level, state.map).sellToBank
              return obj
            })
            playerFields = _.orderBy(playerFields, ['value'], ['asc'])
            const potencialSell = calcTheSellingIds(playerFields)
            // console.log('Kell: ', state.sellValue);
            // console.log('potenciális: ', _.sum(potencialSell.values));
            // console.log('potenciálisID: ', potencialSell.ids);

            state.players[state.currentPlayer].money += _.sum(potencialSell.values) - state.sellValue
            for (let i = 0; i < potencialSell.ids.length; i++) {
              state.map[potencialSell.ids[i]].ownerColor = null
              state.map[potencialSell.ids[i]].hasDoubler = false
              state.map[potencialSell.ids[i]].doublerCount = 0
              state.map[potencialSell.ids[i]].level = 0
            }

          } else if (vagyon + card.moneyValue < 0) { // ha nincs semmi akkor csőd
            state.currentPlayerIndex -= 1
            state.players[state.currentPlayer].money = 0
            state.players[state.currentPlayer].isBankrupt = true
            const fields = state.map.filter(x => x.ownerColor === state.currentPlayer)
            for (let i = 0; i < fields.length; i++) {
              state.map[fields[i].id].ownerColor = null
              state.map[fields[i].id].hasDoubler = false
              state.map[fields[i].id].doublerCount = 0
              state.map[fields[i].id].level = 0
            }
          }
        }
      }
    },
    setGameState: (state, action) => {
      // console.log(action.payload.roomCode)
      state.roomCode = action.payload.roomCode
      state.players = action.payload.players
      state.endDate = action.payload.endDate
      state.isLoaded = action.payload.isLoaded
      state.map = action.payload.map
    },
    setSelectedCard: (state, action) => {
      state.selectedCard = action.payload
    },
    resetState: (state, action) => {
      state = initState
    }


  },
})

// Action creators are generated for each case reducer function
export const {
  nextPlayer,
  setShowDiceRoll,
  setDiceRollValue,
  setShowBalance,
  setShowBuyPanel,
  minusTandij,
  buyLand,
  buyMuseum,
  giveRoundBonus,
  resetCountdown,
  payTax,
  setShowFirstQuarantineTab,
  setShowQuarantineTab,
  startQuarantine,
  buyPCR,
  setRollingDiceFromQuarantine,
  QuarantineRoundsDowner,
  removePCR,
  addSelection,
  putDoublerTo,
  setShowDoubler,
  setSelectDoubler,
  setShowErasmus,
  setSelectErasmus,
  setField,
  setBankrupt,
  setShowSell,
  setSellValue,
  sellSelectedFields,
  autoSellSelectedFields,
  setShowTax,
  doPunishment,
  setShowCard,
  applyCardEffect,
  setGameState,
  setSelectedCard,
  resetState

} = gameStateSlice.actions

export default gameStateSlice.reducer