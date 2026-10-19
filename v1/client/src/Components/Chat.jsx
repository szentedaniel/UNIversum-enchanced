import { Avatar, Divider } from '@mui/material'
import React from 'react'
import stringToColor from '../Utils/stringToColor'

export default function Chat() {
    return (
        <>
            <div className="w-4/12 sm:hidden xs:hidden h-11/12 border-4 border-sajat-100/20 rounded-xl m-4 pr-5 pl-5 ml-0 bg-sajat-600">

                <div className="flex justify-center items-center mt-4 mb-2 text-xl">Chat</div>
                <Divider />
                <div className='flex center-items justify-center mt-10'>
                    HAMAROSAN...
                </div>

            </div>
        </>
    )
}
