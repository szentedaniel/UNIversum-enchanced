export interface gameStateData {
  status: number
  isLoaded: boolean
  roomCode: number
  currentPlayer: number
  showDiceRoll: boolean
  showBalance: boolean
  showBuyPanel: boolean
  showFirstQuarantineTab: boolean
  showQuarantineTab: boolean
  rollingDiceFromQuarantine: boolean
  showDoubler: boolean
  selectDoubler: boolean
  showErasmus: boolean
  selectErasmus: boolean
  showDisabledFields: boolean
  singleSelecting: boolean
  multipleSelecting: boolean
  onlyOwnField: boolean
  selectedFields: number[]
  showSell: boolean
  showTax: boolean
  sellValue: number
  sellIsFrom: string
  lastDiceRoll: number
  museumPrice: number
  roundBonus: number
  resetCountdown: number
  currentPlayerIndex: number
  gameOver: boolean
  winnerColor: number | null
  endDate: string
  selectedCard: number
  showCard: boolean
  players: Player[]
  map: Field[]
}

interface Player {
  username: string
  userId: string
  colorCode: number
  money: number
  hasPCR: boolean
  coutPCR: number
  isInQuarantine: boolean
  QuarantineRounds: number
  field: number
  timeRemain: number
  playerCountdown: boolean
  isBankrupt: boolean
}

interface Field {
  id: number
  level: number | null
  ownerColor: number | null
  hasDoubler: boolean
  doublerCount: number
}