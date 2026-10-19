import { createSlice } from '@reduxjs/toolkit'

export const counterSlice = createSlice({
  name: 'loading',
  initialState: {
    isLoading: false,
    isGame: false,
  },
  reducers: {
    setLoading: (state, action) => {
      state.isLoading = action.payload
    },
    setIsGame: (state, action) => {
      state.isGame = action.payload
    },
  },
})

// Action creators are generated for each case reducer function
export const { setLoading, setIsGame } = counterSlice.actions

export default counterSlice.reducer