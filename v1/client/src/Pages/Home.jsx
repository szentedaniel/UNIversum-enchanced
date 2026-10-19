import React, { useEffect } from 'react'
import App from '../Components/App'
import Lobby from '../Components/LobbyComponent/Lobby'
import Loading from '../Components/Loading'

import { useSelector, useDispatch } from 'react-redux'
import { useLocation } from 'react-router-dom'
import { setIsGame, setIsHomepage } from '../Store/slices/loadingSlice'
import Logo from '../Components/Logo'



function Home() {
    const { isLoading } = useSelector((state) => state.loading)
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
        <>
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
                            <Logo />
                            <Lobby />

                        </div>
                    </div>
                </div>
            </div>

        </>
    )
}

export default Home
