const bcrypt = require('bcrypt')
import { generateRoomCode } from './utils/generateRoomCode'
const MESSAGES = require('./config/messages')
import { Server, Socket } from "socket.io";
import { Client } from "socket.io/dist/client";
import { ClientData, JoinRoomData, RoomData } from "./types/RoomSystemTypes";

let io: Server | null = null
export const setIo = (io_: Server) => {
  io = io_
}

const saltRounds = 10
const salt: string = bcrypt.genSaltSync(saltRounds)

export const createRoom = (socket_: Socket, rooms_: Map<string, RoomData>, roomData: RoomData) => {

  const roomId = generateRoomCode(rooms_)
  try {
    let pwd
    if (roomData.hasPassword) pwd = bcrypt.hashSync(roomData.password, salt)


    socket_.emit('get_room', {
      room: roomId,
      lobbyName: (roomData.lobbyName === null) ? ('Lobby ' + roomId) : roomData.lobbyName,
      maxPlayerNumber: roomData.maxPlayerNumber,
      hasPassword: roomData.hasPassword,
      password: pwd,
      minute: roomData.minute
    })

    rooms_.set(roomId, {
      users: [],
      code: roomId,
      lobbyName: (roomData.lobbyName === null) ? ('Lobby ' + roomId) : roomData.lobbyName,
      maxPlayerNumber: roomData.maxPlayerNumber,
      hasPassword: roomData.hasPassword,
      password: pwd,
      minute: roomData.minute
    })
    sendRoomsToClient(rooms_)
  } catch (error) {
    console.log(error)
  }
}

export const joinRoom = (socket_: Socket, rooms_: Map<string, RoomData>, allClients_: Map<string, ClientData>, data_: JoinRoomData) => {
  try {
    if (data_.create) {

      socket_.join(data_.room)

      allClients_.get(socket_.id)!.room = data_.room

      const room = rooms_.get(data_.room)
      room!['users'].push({
        userId: socket_.id,
        username: allClients_.get(socket_.id)!.username!
      })

      console.log(`User with ID: ${socket_.id} joined room: ${data_.room}`)
      //console.log(rooms_)
      socket_.emit('joined_room', {
        status: 200,
        room: data_.room,
        team: rooms_.get(data_.room.toString())
      })
      socket_.to(data_.room).emit('user_joined', {
        user: socket_.id,
        team: rooms_.get(data_.room.toString())
      })


    } else {

      if (rooms_.has(data_.room)) {
        const room = rooms_.get(data_.room)!
        if (room['users'].length < room!['maxPlayerNumber']) {
          if (room['hasPassword']) {
            if (bcrypt.compareSync((data_.password || ''), room['password'])) {
              console.log(data_.password.toString())
              console.log(bcrypt.compareSync(data_.password.toString(), room['password']))
              socket_.join(data_.room)
              allClients_.get(socket_.id)!.room = data_.room
              //rooms[data.room].users.push({userId: socket.id})
              //rooms.push({[data.room]: {userId: socket.id}})
              room['users'].push({
                userId: socket_.id,
                username: allClients_.get(socket_.id)!.username!
              })
              console.log(room['users'])
              console.log(`User with ID: ${socket_.id} joined room: ${data_.room}`)
              console.log(rooms_)
              socket_.emit('joined_room', {
                status: 200,
                room: data_.room,
                team: rooms_.get(data_.room.toString())
              })
              socket_.to(data_.room).emit('user_joined', {
                user: socket_.id,
                team: rooms_.get(data_.room.toString())
              })
            } else {
              socket_.emit('joined_room', {
                status: 402,
                room: null,
                message: MESSAGES[402]
              })
            }


          } else {
            socket_.join(data_.room)
            allClients_.get(socket_.id)!.room = data_.room
            //rooms[data.room].users.push({userId: socket.id})
            //rooms.push({[data.room]: {userId: socket.id}})
            room['users'].push({
              userId: socket_.id,
              username: allClients_.get(socket_.id)!.username!
            })
            console.log(room['users'])
            console.log(`User with ID: ${socket_.id} joined room: ${data_.room}`)
            console.log(rooms_)
            socket_.emit('joined_room', {
              status: 200,
              room: data_.room,
              team: rooms_.get(data_.room.toString())
            })
            socket_.to(data_.room).emit('user_joined', {
              user: socket_.id,
              team: rooms_.get(data_.room.toString())
            })
          }
          //io.emit('joined_room', {status: 200,room: data.room, rooms: Object.fromEntries(rooms)})
        } else {
          socket_.emit('joined_room', {
            status: 403,
            room: null,
            message: MESSAGES[403]
          })
        }

      } else {
        socket_.emit('joined_room', {
          status: 404,
          room: null,
          message: MESSAGES[404]
        })
      }
    }
    sendRoomsToClient(rooms_)
  } catch (error) {
    try {
      console.log(error)
      socket_.emit('joined_room', {
        status: 503,
        room: null,
        message: MESSAGES[503]
      })
    } catch (error) {
      console.log(error)
    }

  }
}

export const leaveRoom = (socket_: Socket, rooms_: Map<string, RoomData>, allClients_: Map<string, ClientData>, serverLeave_ = false) => {
  try {
    const socketId = socket_.id
    if (allClients_.has(socketId)) {


      const roomID = allClients_.get(socketId)!.room
      if (roomID) {

        const user = rooms_.get(roomID)!['users'].filter(it => it.userId === socketId)[0]
        rooms_.get(roomID)!['users'].splice(rooms_.get(roomID)!['users'].indexOf(user), 1)

        if (rooms_.get(roomID)!['users'].length === 0) {
          rooms_.delete(roomID)
        }
        console.log(rooms_)
        socket_.emit('leaved_room')
        socket_.to(roomID).emit('user_left', {
          user: socketId,
          team: (rooms_.get(roomID))
        })
        console.log(`User with ID: ${socket_.id} left room: ${roomID}`)

      }

      console.log('1 user disconnected', socketId)

      if (serverLeave_) {
        allClients_.delete(socketId)
      } else {
        allClients_.get(socketId)!.room = null
      }
    }
    sendRoomsToClient(rooms_)
  } catch (error) {
    console.log(error)
  }

}

export const sendRoomsToClient = (rooms_: Map<string, RoomData>) => {

  io!.emit('get_rooms_res', { rooms: Object.fromEntries(rooms_) })

}


export const getRoomById = (socket: Socket, id: string, rooms: Map<string, RoomData>) => {

  if (rooms.has(id)) socket.emit('get_room_by_id_res', { status: 200, room: rooms.get(id), message: MESSAGES[200] })
  else socket.emit('get_room_by_id_res', { status: 404, room: null, message: MESSAGES[404] })


}

