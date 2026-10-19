import { includes } from "lodash"
import { GAME_CONFIG } from "../gameConfig"

const calcPrice = (id, level, fields) => {

  let isMonopolium = false

  let doublerTandij = null

  const isMuseum = GAME_CONFIG.map[id].isMuseum
  let museumMultiplier = 1

  if (fields) {
    const ownerColor = fields[id].ownerColor
    const groupId = GAME_CONFIG.map[id].groupId
    const filteredGroup = GAME_CONFIG.map.filter(x => x.groupId === groupId)
    const ids = filteredGroup.map(x => x.id)

    let filteredColorOwnerGroup = fields.map(x => {
      if (ids.includes(x.id)) {
        return x.ownerColor
      }
      return null
    })

    filteredColorOwnerGroup = filteredColorOwnerGroup.filter(x => { return x !== null })

    const occurrences = filteredColorOwnerGroup.reduce(function (acc, curr) {
      return acc[curr] ? ++acc[curr] : acc[curr] = 1, acc
    }, {})

    if (occurrences[ownerColor] === ids.length) {
      isMonopolium = true
    }

    if (isMuseum) {
      museumMultiplier = (occurrences[ownerColor]) ? occurrences[ownerColor] : 0

      if (fields[id].hasDoubler) {
        doublerTandij = (fields[id].doublerCount + 1)
      }

      return {
        toBuy: (fields[id].ownerColor) ? null : 400000,
        tandij: 75_000 * museumMultiplier * (doublerTandij ? doublerTandij : 1),
        sellToBank: 400000 * 0.9,
        sellToPlayer: null
      }
    }

    if (fields[id].hasDoubler) {
      doublerTandij = calcPrice(id, level, null).tandij * (fields[id].doublerCount + 1)
    }
  }



  const start = 200000
  const diffOnLevel = 20000
  let buyScale = 0
  let tandijScale = 0
  if (level === 0) {
    return {
      toBuy: 0,
      tandij: 0,
      sellToBank: 0,
      sellToPlayer: 0
    }
  }
  if (level === 1) { buyScale = 0.2; tandijScale = 0.55 }
  if (level === 2) { buyScale = 0.2; tandijScale = 0.7 }
  if (level === 3) { buyScale = 0.3; tandijScale = 0.85 }
  if (level === 4) { buyScale = 0.4; tandijScale = 1 }

  let correctId = id

  for (let i = 1; i < id; i++) {
    if (!GAME_CONFIG.map[i].isNormal) {
      correctId--
    }
  }
  const toBuy = start + ((correctId - 1) * diffOnLevel) + ((level - 1) * ((start + ((correctId - 1) * diffOnLevel)) * buyScale))
  const tandij = (toBuy * tandijScale) * (isMonopolium ? 1.4 : 1)

  return {
    toBuy: Math.round(toBuy),
    tandij: Math.round((doublerTandij ? doublerTandij : tandij)),
    sellToBank: Math.round(Math.round(toBuy) * 0.9),
    sellToPlayer: Math.round(toBuy * 2)
  }
}

export default calcPrice