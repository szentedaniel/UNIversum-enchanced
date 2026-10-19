import React, { useContext } from 'react'
import io from "socket.io-client";
import { SOCKET_URL } from '../config'

const socket = io(SOCKET_URL)
const SocketContext = React.createContext(socket)

export const useSocket = () => {
    return useContext(SocketContext)
}


export function SocketProvider ({children}) {
    return(
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    )
}
