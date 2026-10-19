import { RoomData } from "../types/RoomSystemTypes"

export const generateRoomCode = (list: Map<string, RoomData>): string => {
    let code: string | null = null
    do {
        code = Math.floor(Math.random() * 900000 + 100000).toString()
    } while (list.has(code))
    return code
}