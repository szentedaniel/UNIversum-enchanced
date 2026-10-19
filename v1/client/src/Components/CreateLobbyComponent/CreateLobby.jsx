import React from "react";
import { useSocket } from '../../Contexts/SocketContext'
import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Link } from "react-router-dom";
import { useSelector, useDispatch } from 'react-redux'
import { setLoading } from '../../Store/slices/loadingSlice'
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Icon } from "@mui/material";
import i18n from "../../i18n";
import hu from './i18n/hu'
import en from './i18n/en'
import de from './i18n/de'

i18n.addResourceBundle('hu', 'CreateLobby', hu);
i18n.addResourceBundle('en', 'CreateLobby', en);
i18n.addResourceBundle('de', 'CreateLobby', de);


export function CreateLobby() {
  //onClick={createRoom}
  const socket = useSocket()
  const { t } = useTranslation('CreateLobby');
  const { isLoading } = useSelector((state) => state.loading)
  const dispatch = useDispatch()
  const navigate = useNavigate()




  const [lobbyName, setLobbyName] = useState(null)
  const [maxPlayerNumber, setMaxPlayerNumber] = useState(4)
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState(null)
  const [minute, setMinute] = useState(50)


  const createRoom = (roomData) => {
    socket.emit('create_room', roomData)
  }

  const checkValidDatas = () => {
    return true
  }

  const handleCreatingLobby = () => {
    dispatch(setLoading(true))
    if (checkValidDatas()) {
      const roomData = {
        lobbyName: (lobbyName === '') ? null : lobbyName,
        maxPlayerNumber: maxPlayerNumber,
        hasPassword: (password === '' || password === null) ? false : hasPassword,
        password: (password === '') ? null : password,
        minute: minute
      }
      console.log(roomData)
      createRoom(roomData)

    }

    dispatch(setLoading(false))
  }


  // ha létrejött a szoba, átirányít
  useEffect(() => {
    socket.on('get_room', data => {
      console.log(data)
      navigate(`/room/${data.room}`, {
        state: {
          created: true,
          hasPassword: hasPassword,
          secoret: password
        }
      })
    })
    return () => {
      socket.off('get_room')
    }
  })
  return (
    <>
      <Link to='/'><button className="back_button mt-5 sm:m-0 xs:m-0"> <Icon>arrow_back_ios</Icon></button></Link>
      <div className='flex flex-1 flex-col sm:flex-col xs:flex-col self-stretch justify-center w-full min-w-[300px] xs:min-w-[200px] p-5'>

        <form autoComplete="off" className="w-full max-w-2xl items-center content-center justify-center m-auto">
          <div className="flex flex-wrap -mx-3 mb-2">
            <div className="w-full px-3 ">
              <label className="block uppercase tracking-wide text-sajat-100 text-xs font-bold mb-2">
                {t('ROOM_NAME')}
              </label>
              <input onChange={e => setLobbyName(e.target.value)} className='
              form-control
              block
              w-full
              px-3
              py-1.5
              text-base
              text-sajat-100
              bg-clip-padding
              border border-solid border-gray-300
              rounded
              transition
              ease-in-out
              m-0
              focus:text-sajat-100 focus:bg-sajat-600 focus:border-sajat-600 focus:outline-none
              bg-sajat-700 hover:bg-sajat-700 focus:ring-4 focus:ring-sajat-300
              font-bold' type="text" placeholder={t('PLACEHOLDER_ROOM')} />
              {/* <p className="text-red-500 text-xs italic">Please fill out this field.</p> */}
            </div>
          </div>
          <div className="flex flex-wrap -mx-3 mb-2">
            {/* <div className="w-full md:w-1/3 px-3 mb-6 md:mb-0">
            <label className="block uppercase tracking-wide text-sajat-100 text-xs font-bold mb-2" for="grid-city">
              City
            </label>
            <input className="appearance-none block w-full bg-gray-200 text-sajat-100 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white focus:border-gray-500" id="grid-city" type="text" placeholder="Albuquerque" />
          </div> */}
            <div className="w-full md:w-1/2 px-3 mb-6 md:mb-0">
              <label className="block uppercase tracking-wide text-sajat-100 text-xs font-bold mb-2" htmlFor="grid-state">
                {t('PLAYERS')}

              </label>
              <div className="relative">
                <select onChange={e => setMaxPlayerNumber(e.target.value)} className="appearance-none ease-in-out focus:text-sajat-100 focus:bg-sajat-600 focus:border-sajat-600 focus:outline-none
              hover:bg-sajat-700 focus:ring-4 focus:ring-sajat-300
              font-bold block w-full bg-sajat-600 border border-gray-200 text-sajat-100 py-3 px-4 pr-8 rounded leading-tight  " id="grid-state">
                  <option value="4">4</option>
                  <option value="3">3</option>
                  <option value="2">2</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-sajat-100">
                  {/* <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg> */}
                </div>
              </div>
            </div>
            <div className="w-full md:w-1/2 px-3 mb-6 md:mb-0">
              <label className="block uppercase tracking-wide text-sajat-100 text-xs font-bold mb-2" htmlFor="grid-state">
                {t('TIME')}

              </label>
              <div className="relative">
                <select onChange={e => setMinute(e.target.value)} className="appearance-none ease-in-out focus:text-sajat-100 focus:bg-sajat-600 focus:border-sajat-600 focus:outline-none
              hover:bg-sajat-700 focus:ring-4 focus:ring-sajat-300
              font-bold block appearance-none w-full bg-sajat-600 border border-gray-200 text-sajat-100 py-3 px-4 pr-8 rounded leading-tight " id="grid-state">
                  <option value="50">50 {t('MIN')}</option>
                  <option value="30">30 {t('MIN')}</option>
                  <option value="15">15 {t('MIN')}</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-sajat-100">
                  {/* <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg> */}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap -mx-3 mb-2">
            <div className="w-full px-3">
              <label className="block uppercase tracking-wide text-sajat-100 text-xs font-bold mb-2 " htmlFor="grid-password">
                {t('PASSWORD')}

              </label>
              <input className={`form-control
                  block
                  w-full
                  px-3
                  py-1.5
                  text-base
                  font-normal
                  text-sajat-100
                  ${(hasPassword ? 'bg-sajat-600' : 'bg-sajat-900')}
                  bg-clip-padding
                  border border-solid border-gray-300
                  rounded
                  transition
                  ease-in-out
                  m-0
                  focus:text-sajat-100 focus:bg-sajat-700 focus:border-sajat-600 focus:outline-none
                  hover:bg-sajat-700 focus:ring-4 focus:ring-sajat-300`}
                id="grid-password"
                type="password"
                placeholder="******************"
                disabled={!hasPassword}
                autoComplete="off"
                onChange={e => setPassword(e.target.value)} />
              {/* <p className="text-gray-600 text-xs italic">Make it as long and as crazy as you'd like</p> */}
            </div>

          </div>
          <div className="flex items-center center content-center self-center  mb-10">
            <input onChange={e => setHasPassword(e.target.checked)} id="remember-me" name="remember-me" type="checkbox" className="h-4 w-4 text-sajat-600 focus:ring-sajat-500 border-gray-300 bg-sajat-700 focus:bg-sajat-400 rounded" />
            <label htmlFor="remember-me" className="ml-2 block text-sm text-sajat-100">{t('PASSWORD')} </label>
          </div>
        </form>

        <div className='flex flex-col items-center'>
          <button className="button " onClick={() => handleCreatingLobby()}> {t('CREATE_LOBBY')}</button>
        </div>
      </div>
    </>
  )
}