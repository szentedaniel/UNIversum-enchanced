import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom';
import logo from '../Images/logos/monopoly_logo.png'

export default function Logo() {
  const { isGame } = useSelector((state) => state.loading)
  //const location = useLocation()
  //const [isHome, setIsHome] = useState((location.pathname === '/'))

  return (
    <>
      {!(isGame) &&
        <div className='logo'>
          <span>
            <div className='w-full h-full overflow-hidden mt-0 m-auto outline-none'>

              {/* <img src={logo} alt='logo' className='transform translate-x-0 translate-y-0'></img> */}
            </div>

          </span>
          <p className=' text-base text-sajat-100 tracking-wide text-5xl'>UNIversum</p>
        </div>}

    </>
  )
}
