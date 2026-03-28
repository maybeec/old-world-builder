import { createSlice } from "@reduxjs/toolkit";

export const nextcloudLoginSlice = createSlice({
  name: "nextcloudLogin",
  initialState: {
    ncLoggedIn: false,
    ncLoginLoading: true,
    ncLoginError: false,
    ncCorsError: false,
    ncIsSyncing: false,
    ncSyncConflict: false,
    ncSyncError: false,
  },
  reducers: {
    updateNextcloudLogin: (state, { payload }) => {
      return {
        ...state,
        ...payload,
      };
    },
  },
});

export const { updateNextcloudLogin } = nextcloudLoginSlice.actions;

export default nextcloudLoginSlice.reducer;
