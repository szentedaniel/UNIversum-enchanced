export const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || `${window.location.hostname}:3001` //'http://szente.ddns.net:3001/' //'localhost:3001' // '192.168.0.10:3001'

export const LANGUAGES = [
  {
    "code": "hu",
    "name": "Magyar",
    "countryCode": "hu"
  },
  {
    "code": "en",
    "name": "English",
    "countryCode": "gb"
  },
  {
    "code": "de",
    "name": "Deutsch",
    "countryCode": "de"
  },

]

export const COLOR_THEMES = {
  '1': {
    'dark': '#262335',
    'lessdark': '#503c52',
    'mid': '#9f6c66',
    'light': '#d4896a',
    'lighter': '#ffbb6c',
  },
  '2': {

  },
  '3': {

  }
}

export const GROUP_COLORS = {
  '0': {
    color: 0x00000000
  },
  '1': {
    color: 0x915537
  },
  '2': {
    color: 0xADDEFE
  },
  '3': {
    color: 0xD43B90
  },
  '4': {
    color: 0xF49424
  },
  '5': {
    color: 0xEA1C25
  },
  '6': {
    color: 0xFBF204
  },
  '7': {
    color: 0x1DB458
  },
  '8': {
    color: 0x0572BB
  },
}

export const PLAYER_COLORS = {
  '0': {
    color: 0xF29DB6
  },
  '1': {
    color: 0x8DB5E7
  },
  '2': {
    color: 0x70C4A8
  },
  '3': {
    color: 0xFFCC00
  },
}