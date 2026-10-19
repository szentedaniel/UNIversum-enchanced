import React, { useEffect, useState } from "react";
import { createRoutesFromChildren, Link, useLocation, useNavigate } from "react-router-dom";
import toast from 'react-hot-toast';
import { useSocket } from '../Contexts/SocketContext'
import { Icon, Avatar } from "@mui/material";
import { RadioGroup } from '@headlessui/react'
import { Divider } from '@mui/material'
import stringToColor from "../Utils/stringToColor";
import Chat from "./Chat";


export function InLobby({ room, setRoom, code }) {
  const socket = useSocket()
  const navigate = useNavigate()

  const [selected, setSelected] = useState(null)
  const [startable, setStartable] = useState(false)

  useEffect(() => {
    console.log(room);
    console.log(room.users.length === room.maxPlayerNumber, room.users.length, room.maxPlayerNumber);
    setStartable(room.users.length === parseInt(room.maxPlayerNumber))
  }, [room])


  useEffect(() => {
    socket.on('leaved_room', data => {
      //console.log(data);
      navigate('/')
    })

    socket.on('user_joined', data => {
      console.log(data);
      setRoom(data.team)
    })

    socket.on('user_left', data => {
      setRoom(data.team)
    })
    socket.on('start_game_res', () => {
      navigate(`/game/${code}`)
    })
    return () => {
      socket.off('leaved_room')
      socket.off('user_joined')
      socket.off('user_left')
      socket.off('start_game_res')
    }
  })

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)

    toast.success('Code copied!!',
      {
        style: {
          backgroundColor: '#d4896a',
          color: '#503c52'
        },
        iconTheme: {
          primary: '#503c52',
          secondary: '#d4896a',
        },
      })
  }

  const leaveRoom = () => {
    socket.emit('leave_room')
    navigate('/')
  }
  const startGame = () => {
    if (startable) {
      socket.emit('start_game_req', code)
      navigate(`/game/${code}`)
    }

  }

  return (
    <>
      <div className="flex flex-row justify-between h-auto w-full text-sajat-100 mt-5 sm:flex-col xs:flex-col">
        <div className="w-36 h-12">
          <Link to='/' onClick={() => socket.off('get_rooms_res')}>
            <button className="back_button" onClick={() => leaveRoom()}>
              <Icon>arrow_back_ios</Icon>
            </button>
          </Link>
        </div>
        <div className="w-36 h-12 text-2xl flex flex-row items-center justify-center">code: <span className="code bg-sajat-600 p-2 rounded-lg ml-2 cursor-pointer" onClick={() => { copyToClipboard(code) }}> {code} </span></div>
        <div className="w-36 h-12 text-2xl flex flex-row items-center justify-center">{room.lobbyName}</div>
        <div className="w-36 h-12 text-lg flex flex-row items-center justify-center">
          <div className='flex flex-col gap-1'>
            <Icon>
              groups
            </Icon>
            <span>
              {room.users.length}/{room.maxPlayerNumber}
            </span>{' '}
          </div>
        </div>
        <div className={`w-36 h-12 text-lg flex flex-row items-center justify-center ${startable ? 'bg-sajat-600 rounded-lg cursor-pointer' : 'bg-gray-600 rounded-lg text-gray-300 cursor-not-allowed'} `}
          onClick={startGame}>
          START GAME
        </div>
      </div>

      {/* <h2><div>Room: <span className="code" onClick={() => { copyToClipboard(code) }}> {code} </span></div></h2>
      <button className="pushable" onClick={() => leaveRoom()}>
        <span className="front"> Leave Room</span>
      </button>
      {room &&
        room['users'].map(member => <p key={member.userId}>{member.username}</p>)} */}


      <div className="flex space-x-4 border-4 border-sajat-100/20 border-solid mt-5 rounded-xl h-[80%] overflow-y-auto xs:min-w-[150px] sm:min-w-[320px] md:min-w-[800px] lg:min-w-[1000px] min-w-[1300px] overflow-hidden">

        <div className="w-7/12 flex-grow overflow-y-scroll simple">
          <div className="w-full px-4 py-4">
            <RadioGroup value={selected} > {/*onChange={setSelected}*/}
              <div className="space-y-2">
                {(room !== null) &&
                  room.users.map((user, index) => (
                    <RadioGroup.Option
                      key={user.userId}
                      value={user}
                      className={({ active, checked }) =>
                        `${active
                          ? 'ring-2 ring-offset-2 ring-offset-sajat-300 ring-white ring-opacity-60'
                          : ''
                        }
                        ${checked ? 'bg-sajat-700 bg-opacity-75 text-white' : 'bg-sajat-600 text-sajat-100'}
                        relative rounded-lg shadow-md px-5 py-4 cursor-pointer flex focus:outline-none`
                      }
                    >
                      {({ active, checked }) => (
                        <>
                          <div className="flex items-center justify-between w-full">

                            <RadioGroup.Label
                              as="span"
                              className={`font-medium text-xl  ${checked ? 'text-sajat-100' : 'text-sajat-900'
                                }`}
                            >
                              <div key={user.username} className="flex flex-row m-2 p-2 items-center">
                                <Avatar
                                  alt={user.username}
                                  src="/static/images/avatar/1.jpg"
                                  sx={{ bgcolor: stringToColor(user.username), }}
                                />
                                <span className="ml-4 text-lg">{user.username}</span>
                              </div>
                            </RadioGroup.Label>
                            <RadioGroup.Description
                              as="span"
                              className={`flex justify-end space-x-10 items-center ${checked ? 'text-sajat-100' : 'text-sajat-200'
                                }`}
                            >
                              {/* <span aria-hidden="true">&middot;</span>{' '} */}
                              <div className='flex flex-col items-center gap-1'>
                                <Icon>
                                  star
                                </Icon>
                                <span>
                                  {(true) ? '-' : 'Public'}
                                </span>{' '}
                              </div>
                              <div className='flex flex-col gap-1'>
                                {/* <Icon>
                                  groups
                                </Icon>
                                <span>
                                  {1}/{2}
                                </span>{' '} */}
                              </div>
                              {/* <button disabled={(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber)} className={` border-2 
                              border-sajat-200 rounded-lg p-2 
                              ${(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'bg-sajat-200 text-sajat-100' : 'bg-sajat-900 hover:bg-sajat-600 focus:ring-sajat-300 focus:ring-1 text-sajat-100'}`} onClick={() => joinRoom(roomCode)}>

                                <div className='flex flex-col items-center'>
                                  <Icon>
                                    {(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'priority_high' : 'login'}
                                  </Icon>
                                  <span>
                                    {(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'Full' : 'Join'}
                                  </span>{' '}
                                </div>
                              </button> */}
                            </RadioGroup.Description>
                          </div>
                        </>
                      )}
                    </RadioGroup.Option>
                  ))}
              </div>
            </RadioGroup>
          </div>
        </div>
        <Chat />
        <div className="mr-4 sm:hidden xs:hidden"></div>
      </div>
    </>
  )
}