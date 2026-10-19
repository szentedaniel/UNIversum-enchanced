/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from "react-router-dom";
import { useSelector } from 'react-redux'
import Icon from '@mui/material/Icon';
import { Divider } from '@mui/material'
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import _ from 'lodash';
import i18n from './../../i18n.js';
import hu from './i18n/hu'
import en from './i18n/en'
import de from './i18n/de'

i18n.addResourceBundle('hu', 'Lobby', hu);
i18n.addResourceBundle('en', 'Lobby', en);
i18n.addResourceBundle('de', 'Lobby', de);


function Lobby() {
  const { t, i18n } = useTranslation('Lobby');

  const user = useSelector((state) => state.user)

  // navigate
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [rooms, setRooms] = useState(null);
  const [roomCode, setRoomCode] = useState(null);

  let firstLoad = true

  useEffect(() => {
    const name = user.username
    setUsername(name)

    firstLoad = false
    return () => {
      return
    }
  }, [i18n.language])

  const joinRoom = (room) => {
    navigate(`/room/${room}`)
  }

  const inputCodeHandler = (e) => {
    if (!/[0-9]/.test(e.key) || e.target.value.length > 5) {
      e.preventDefault();
    }
  }

  return (
    <>
      <div className='flex flex-col p-5'>
        <div className="flex flex-row justify-center items-center space-x-1 mb-2"><Icon>account_circle</Icon><h1>{t('username')}</h1></div>
        <h2 className="text-3xl self-center mb-10">{username}</h2>

        <>

          {<>
            {/* <Link to='/create' className="self-center">
              <button className="button" >
                <Icon>play_circle</Icon>
                <span className="front">{t('PLAY_NOW')}</span>
              </button>
            </Link>
            <div>
              <Divider>
                <p className="self-center">{t('or')}</p>
              </Divider>
            </div> */}
            <Link to='/create' className="self-center">
              <button className="button" >
                <Icon>add_circle</Icon>
                <span className="front">{t('create_lobby')}</span>
              </button>
            </Link>
            <div>
              <Divider>
                <p className="self-center">{t('or')}</p>
              </Divider>
            </div>


            {/* <input onKeyPress={(e) => inputCodeHandler(e)} type="text" onChange={e => setRoomCode(e.target.value)} /> */}

            <Link to='/rooms' className="self-center" state={{ rooms: rooms }}>
              <button className="button">
                <Icon>meeting_room</Icon>
                <span className="front">{t('show_lobbies')}</span>
              </button>
            </Link>

            <div>
              <Divider>
                <p className="self-center">{t('or')}</p>
              </Divider>
            </div>



            <div className="flex flex-wrap -mx-3 mb-2 center self-center content-center justify-center items-center space-x-5">
              <div className=" max-w-md px-3 ">
                {/* <label className="block uppercase text-sajat-100 text-xs font-bold mb-2" for="grid-first-name">
                Room's name
              </label> */}
                <input onKeyPress={(e) => inputCodeHandler(e)} type="text" autoComplete="off" onChange={e => setRoomCode(e.target.value)} className="" id="grid-first-name" />
                {/* <p className="text-red-500 text-xs italic">Please fill out this field.</p> */}
              </div>
              <button className="button" onClick={() => joinRoom(roomCode)}>
                <Icon>sports_esports</Icon>
                <span className="front">{t('join_lobby')}</span>
              </button>
            </div>


          </>
          }
        </>
      </div>
      {/*  <div className='flex flex-col h-3/4 sm:w-full border-4 border-sajat-100/20 rounded-2xl items-center border-solid px-3'>
        <div
          component={motion.div}
          initial={{ x: 200 }}
          animate={{ x: 0 }}
          transition={{ bounceDamping: 0 }}
          className="w-full max-w-400 mx-auto m-1 rounded-20 bg-sajat-700"
          square
          layout
        >
          <div className="flex flex-col items-center justify-center p-16 sm:p-32 md:p-48 md:pt-128 ">
            <span variant="h6" className="mb-24 font-semibold text-18 sm:text-24">
              {t('CREATE_TITLE')}
            </span>

            <form
              name="registerForm"
              noValidate
              className="flex flex-col justify-center w-full"
              onSubmit={handleSubmit(onSubmit)}
            >
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    className="mb-16"
                    label={t('NAME')}
                    autoFocus
                    type="name"
                    error={!!errors.name}
                    helperText={errors?.name?.message}
                    variant="outlined"
                    required
                    fullWidth
                  />
                )}
              />

              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    className="mb-16"
                    label="Email"
                    type="email"
                    error={!!errors.email}
                    helperText={errors?.email?.message}
                    variant="outlined"
                    required
                    fullWidth
                  />
                )}
              />

              <Controller
                name="password"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    className="mb-16"
                    label={t('PASSWORD')}
                    type="password"
                    error={!!errors.password}
                    helperText={errors?.password?.message}
                    variant="outlined"
                    required
                    fullWidth
                  />
                )}
              />

              <Controller
                name="passwordConfirm"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    className="mb-16"
                    label={t('PASSWORD_CONFIRM')}
                    type="password"
                    error={!!errors.passwordConfirm}
                    helperText={errors?.passwordConfirm?.message}
                    variant="outlined"
                    required
                    fullWidth
                  />
                )}
              />

              <Controller
                name="acceptTermsConditions"
                control={control}
                render={({ field }) => (
                  <FormControl className="items-center" error={!!errors.acceptTermsConditions}>
                    <FormControlLabel label={t('AFSZ')} control={<Checkbox {...field} />} />
                    <FormHelperText>{errors?.acceptTermsConditions?.message}</FormHelperText>
                  </FormControl>
                )}
              />

              <Button
                variant="contained"
                color="primary"
                className="w-full mx-auto mt-16"
                aria-label="Register"
                disabled={_.isEmpty(dirtyFields) || !isValid}
                type="submit"
              >
                {t('REGISTER_BUTTON')}
              </Button>
            </form>

            <div className="flex flex-col items-center justify-center pt-32 pb-24">
              <span className="font-normal">{t('ALREADY_TITLE')}</span>
              <Link className="font-normal" to="/login">
                {t('LOGIN_BUTTON')}
              </Link>
            </div>
          </div>
        </div>
        <LobbiesList />
      </div>*/}
    </>
  )
}

export default Lobby