import { gameStateData } from "../types/GameStateTypes"

let initialState: gameStateData = {
  status: 200,
  isLoaded: false,
  roomCode: 0,
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
  endDate: '',
  selectedCard: 0,
  showCard: false,
  players: [
    {
      username: 'user' + Math.floor(Math.random() * 999999),
      userId: '',
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
      userId: '',
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
      userId: '',
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
      userId: '',
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

export default initialState