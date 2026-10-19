import { Server, Socket } from "socket.io";
import { RoomData } from "../types/RoomSystemTypes";
import _ from 'lodash'
import initialState from '../GameSystem/initialState'
import { gameStateData } from "../types/GameStateTypes";


let io: Server | null = null
export const setGameIo = (io_: Server) => {
  io = io_
}

export const sendGameStateByCode = (socket: Socket, code: string, rooms: Map<string, RoomData>) => {
  if (rooms.has(code)) {
    let users = rooms.get(code)!.users
    // _.shuffle(users)

    const minute = rooms.get(code)!.minute

    const players = users.map(x => {
      return {
        username: x.username,
        userId: x.userId,
        colorCode: 0,
        money: 2_500_000,
        hasPCR: false,
        coutPCR: 0,
        isInQuarantine: false,
        QuarantineRounds: 0,
        field: 0,
        timeRemain: 0,
        playerCountdown: false,
        isBankrupt: false
      }
    })

    players[0].playerCountdown = true
    for (let i = 0; i < players.length; i++) {
      players[i].colorCode = i
    }
    console.log(players)

    const gameState: gameStateData = {
      ...initialState,
      players: players,
      endDate: new Date(new Date().getTime() + minute * 60000).toISOString(),
      roomCode: Number(code),
      isLoaded: true,
      map: initialState.map
    }

    // console.dir(gameState, { depth: null })

    socket.emit('get_game_data_by_code_res', gameState)
  } else socket.emit('get_game_data_by_code_res', { status: 404 })

}