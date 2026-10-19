import { configureStore } from '@reduxjs/toolkit'
import loadingReducer from './slices/loadingSlice'
import userReducer from './slices/userSlice'
import gameStateReducer from './slices/gameStateSlice'

export default configureStore({
  reducer: {
    loading: loadingReducer,
    user: userReducer,
    gameState: gameStateReducer,
  },
})