export interface ClientData {
    room: string | null
    username: string | null
}

export interface RoomData {
    users: UserData[]
    code: string
    lobbyName: string
    maxPlayerNumber: number
    hasPassword: boolean
    password: string
    minute: number
}

interface UserData {
    userId: string
    username: string
}

export interface JoinRoomData {
    room: string
    create: boolean
    password: string
}