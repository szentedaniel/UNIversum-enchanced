import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

export function LobbyElement({ lobbyName, roomCode, usersCount, usersMax, hasPassword, password, joinFun, className }) {

    const [pw, setPw] = useState(null)

    return (
        <div className={className}>
            <p>{lobbyName}</p>
            <span>{roomCode} | </span>
            <span>{usersCount}/{usersMax}</span>
            {hasPassword &&
                <></>
            }
            <button disabled={(usersCount === usersMax)} className="pushable" onClick={() => joinFun(roomCode)}>
                <span className="front"> Join lobby</span>
            </button>
        </div>
    )
}