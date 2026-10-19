import { Icon } from '@mui/material'
import React from 'react'
import { useFullscreen } from '@mantine/hooks';
import PropTypes from 'prop-types';


export default function FullscreenSwitcher(props) {
  const { toggle, fullscreen } = useFullscreen()
  return (
    <div onClick={toggle} className='absolute w-10 h-10 rounded-full bg-green-300 border-4 border-green-100 right-10 bottom-40 flex items-center justify-center shadow-md text-green-100 cursor-pointer'>
      <Icon >{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</Icon>
    </div>
  )
}

FullscreenSwitcher.propTypes = {
  fullscreen: PropTypes.bool.isRequired,
  toggle: PropTypes.func.isRequired
}