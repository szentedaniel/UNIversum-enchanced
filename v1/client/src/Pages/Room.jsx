import React, { useEffect, useState } from 'react'
import { InLobby } from '../Components/InLobby'
import { useSelector, useDispatch } from 'react-redux'
import { setIsGame, setLoading } from '../Store/slices/loadingSlice'
import { useSocket } from '../Contexts/SocketContext'
import { useLocation, useParams } from 'react-router-dom';
import { useNavigate } from "react-router-dom";
import PasswordPopup from '../Components/PasswordPopup'
import Logo from '../Components/Logo'



function Room(props) {

  const { code } = useParams();
  const { state } = useLocation();
  const socket = useSocket()
  const navigate = useNavigate()
  const location = useLocation();


  //redux store
  const { isLoading } = useSelector((state) => state.loading)
  const User = useSelector((state) => state.user)
  const dispatch = useDispatch()
  dispatch(setIsGame(false))

  //console.log(code);
  const [room, setRoom] = useState(null)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState(null)
  const [showPasswordPopup, setShowPasswordPopup] = useState(false);
  const [pw, setPw] = useState(null)



  const getRoomById = (id) => {
    socket.emit('get_room_by_id_req', id)
  }

  const joinRoom = (room, create = true, password = null) => {
    socket.emit('join_room', { room: room, create: create, password: password })
  }


  const openPasswordInput = () => {
    setPw(null)
    setShowPasswordPopup(true)
    console.log('ShowPasswordPopup beallítva: ', true);
  }


  const joinHandler = (Room) => {
    if (Room) {
      if (!Room.hasPassword) {
        joinRoom(Room.code, false, null)
        console.log('joined becaouse no pass');
      } else if (state) {
        if (state.created) {
          joinRoom(Room.code, false, state.secret)
          console.log('joined because created')
        }
      } else {
        openPasswordInput()
        console.log('has password popup open')
      }
    }
  }
  //oldal betöltésekor
  useEffect(() => {
    dispatch(setLoading(true))

    // if (location.pathname === '/')
    //   dispatch(setIsHomepage(true))
    // else dispatch(setIsHomepage(false))

    // megkapva a szoba adatait
    socket.off('get_room_by_id_res')
      .on('get_room_by_id_res', data => {
        console.log(data);
        setRoom(data.room)
        setMessage(data.message)
        dispatch(setLoading(false))
        joinHandler(data.room)
      })
    getRoomById(code)

    // csatlakozva a szobához
    socket.off('joined_room').on('joined_room', data => {
      console.log(data)
      setMessage(data.message)
      setStatus(data.status)
      console.log('status beallitva: ', data.status)

      if (data.status === 200) setRoom(data.team)
      else openPasswordInput()

      dispatch(setLoading(false))
    })


    return () => {
      socket.off('get_room_by_id_res')
      socket.off('joined_room')
    }
  }, [0])

  // ha kapott jelszót akkor...
  useEffect(() => {
    if (room) {
      joinRoom(room.code, false, pw)

    }
    console.log(room);
    console.log('jelszo valtozott')
  }, [pw]);


  const backToHome = () => {
    navigate('/')
  }

  return (

    <div className="App bg-sajat-900 text-sajat-100 overflow-hidden">
      <div className='
        flex
        flex-1
        relative
        justify-center
        items-center
        overflow-auto'>
        <div className='border-4 border-solid border-sajat-100/20 sm:border-none xs:border-none rounded-xl flex flex-column w-[90%] h-[90%] m-auto'>
          {/* //transform-none xl:scale-[.8] lg:scale-[.65] md:scale-[0.5] */}
          <div className='flex flex-1 items-center relative flex-col self-stretch'>
            <div className='h-full overflow-hidden flex flex-col mb-4'>
              <Logo />

              {room ?
                <>
                  {(status === 200) &&
                    <>
                      <InLobby room={room} setRoom={setRoom} code={code} />
                    </>
                  }
                </>
                :
                <>
                  <h1>{message}</h1>
                  <button className="pushable" onClick={() => backToHome()}>
                    <span className="front">Back to home</span>
                  </button>
                </>}
              <PasswordPopup showPasswordPopup={showPasswordPopup} setShowPasswordPopup={setShowPasswordPopup} setPw={setPw} />
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default Room
