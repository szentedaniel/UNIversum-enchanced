/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useSelector, useDispatch } from 'react-redux'
import { setLoading } from '../Store/slices/loadingSlice'
import { useSocket } from '../Contexts/SocketContext'
import { LobbyElement } from "./LobbyElement";
import { Link } from "react-router-dom";
import { Icon, Avatar } from "@mui/material";
import { RadioGroup } from '@headlessui/react'
import { Divider } from '@mui/material'
import stringToColor from "../Utils/stringToColor";

export function LobbiesList() {
  // socket
  const socket = useSocket()

  //redux store
  const { isLoading } = useSelector((state) => state.loading)
  const dispatch = useDispatch()

  // navigate
  const navigate = useNavigate()

  const [Rooms, setRooms] = useState(null)

  const [selected, setSelected] = useState(null)


  useEffect(() => {
    console.log(selected)
  }, [selected])


  useEffect(() => {

    dispatch(setLoading(true))

    socket.off('get_rooms_res').on('get_rooms_res', data => {

      console.log(data['rooms'])
      if (data !== null) setRooms(data); setSelected(Object.keys(data['rooms'])[0])

      dispatch(setLoading(false))

    })

    socket.off('joined_room').on('joined_room', data => {

      console.log(data)
      // if (data.status === 200) {
      //   navigate(`/room/${data.room}`, {state: {room: data.room}})
      // }
      socket.off('get_rooms_res')
      dispatch(setLoading(false))

    })

    socket.emit('get_rooms_req')
    return () => {
      socket.off('get_rooms_res')
      // socket.off('joined_room')
    }
  }, [0])



  const joinRoom = (room) => {
    // socket.emit('join_room', {
    //   room: room,
    //   create: create,
    //   password: password
    // })

    navigate(`/room/${room}`)

  }
  return (
    <>
      <div className="flex justify-between h-auto w-full text-sajat-100 mt-5">
        <div className="w-36 h-12">
          <Link to='/' onClick={() => socket.off('get_rooms_res')}>
            <button className="back_button">
              <Icon>arrow_back_ios</Icon>
            </button>
          </Link></div>
        <div className="w-36 h-12 text-2xl flex flex-row items-center justify-center">Szobák</div>
        <div className="w-36 h-12 text-lg flex flex-row items-center justify-center">
          <h3>össz: {(Rooms !== null) ? Object.keys(Rooms['rooms']).length.toString() : 0}</h3>
        </div>
      </div>
      <div className="flex space-x-4 border-4 border-sajat-100/20 border-solid mt-5 rounded-xl h-[80%] overflow-y-auto xs:min-w-[150px] sm:min-w-[320px] md:min-w-[800px] lg:min-w-[1000px] min-w-[1300px] overflow-hidden">

        <div className="w-7/12 flex-grow overflow-y-scroll simple">
          <div className="w-full px-4 py-4">
            <RadioGroup value={selected} onChange={setSelected}>
              <div className="space-y-2">
                {(Rooms !== null) &&
                  Object.keys(Rooms['rooms']).map((roomCode, index) => (
                    <RadioGroup.Option
                      key={roomCode}
                      value={roomCode}
                      className={({ active, checked }) =>
                        `${active
                          ? 'ring-2 ring-offset-2 ring-offset-sajat-300 ring-white ring-opacity-60'
                          : ''
                        }
                        ${checked ? 'bg-sajat-700 bg-opacity-75 text-white' : 'bg-sajat-600 text-sajat-100'
                        }
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
                              {Rooms['rooms'][roomCode].lobbyName}
                            </RadioGroup.Label>
                            <RadioGroup.Description
                              as="span"
                              className={`flex justify-end space-x-10 items-center ${checked ? 'text-sajat-100' : 'text-sajat-200'
                                }`}
                            >
                              {/* <span aria-hidden="true">&middot;</span>{' '} */}
                              <div className='flex flex-col items-center gap-1'>
                                <Icon>
                                  {(Rooms['rooms'][roomCode].hasPassword) ? 'lock' : 'lock_open'}
                                </Icon>
                                <span>
                                  {(Rooms['rooms'][roomCode].hasPassword) ? 'Private' : 'Public'}
                                </span>{' '}
                              </div>
                              <div className='flex flex-col gap-1'>
                                <Icon>
                                  groups
                                </Icon>
                                <span>
                                  {Rooms['rooms'][roomCode].users.length}/{Rooms['rooms'][roomCode].maxPlayerNumber}
                                </span>{' '}
                              </div>
                              <button disabled={(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber)} className={` border-2 
                              border-sajat-200 rounded-lg p-2 
                              ${(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'bg-sajat-400 text-sajat-100' : 'bg-sajat-900 hover:bg-sajat-600 focus:ring-sajat-300 focus:ring-1 text-sajat-100'}`} onClick={() => joinRoom(roomCode)}>

                                <div className='flex flex-col items-center'>
                                  <Icon>
                                    {(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'priority_high' : 'login'}
                                  </Icon>
                                  <span>
                                    {(Rooms['rooms'][roomCode].users.length === Rooms['rooms'][roomCode].maxPlayerNumber) ? 'Full' : 'Join'}
                                  </span>{' '}
                                </div>
                              </button>
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
        <div className="w-4/12 sm:hidden xs:hidden h-11/12 border-4 border-sajat-100/20 rounded-xl m-4 pr-5 pl-5 ml-0 bg-sajat-700">

          <div className="flex justify-center items-center mt-4 mb-2 text-xl">Játékosok a szobában</div>
          <Divider />
          {selected &&
            Rooms['rooms'][selected].users.map(user => (
              <div key={user.username} className="flex flex-row m-2 p-2 items-center">
                <Avatar
                  alt={user.username}
                  src="/static/images/avatar/1.jpg"
                  sx={{ bgcolor: stringToColor(user.username), }}
                />
                <span className="ml-4 text-lg">{user.username}</span>
              </div>
            ))
          }

        </div>
        <div className="mr-4 sm:hidden xs:hidden"></div>
      </div>
    </>

  )
}

function CheckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx={12} cy={12} r={12} fill="#fff" opacity="0.2" />
      <path
        d="M7 13l3 3 7-7"
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}