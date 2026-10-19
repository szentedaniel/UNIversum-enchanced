import React, { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation } from 'react-router-dom';
import { CreateLobby } from '../Components/CreateLobbyComponent/CreateLobby'
import Logo from '../Components/Logo';
import { setIsGame, setIsHomepage } from '../Store/slices/loadingSlice'



function Create() {
  const dispatch = useDispatch()
  dispatch(setIsGame(false))

  const location = useLocation();
  console.log(location.pathname);
  useEffect(() => {
    // if (location.pathname === '/')
    //     dispatch(setIsHomepage(true))
    // else dispatch(setIsHomepage(false))
  }, [])
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

          <div className='flex flex-1 items-center relative flex-col self-stretch'>

            <div className='h-full overflow-hidden'>
              <Logo />

              <CreateLobby />
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default Create
