import { useEffect } from "react";
import { useDispatch } from "react-redux";

import { updateNextcloudLogin } from "../state/nextcloudLogin";
import { setSettings, updateSetting } from "../state/settings";
import { setLists } from "../state/lists";
import { getSyncFile, getDataFile } from "./file";

const DATA_FILE_PATH = "owb-data.json";
const SYNC_FILE_PATH = "owb-sync.txt";

let ncIsSyncing = false;
let pollInterval = null;
let loginPopup = null;

const getCredentials = () => ({
  server: localStorage.getItem("owb.nextcloud.server"),
  loginName: localStorage.getItem("owb.nextcloud.loginName"),
  appPassword: localStorage.getItem("owb.nextcloud.appPassword"),
});

const getAuthHeader = (loginName, appPassword) =>
  "Basic " + btoa(`${loginName}:${appPassword}`);

const getWebDavUrl = (server, loginName, fileName) =>
  `${server}/remote.php/dav/files/${encodeURIComponent(loginName)}/${fileName}`;

const uploadFile = (server, loginName, appPassword, fileName, content) => {
  const url = getWebDavUrl(server, loginName, fileName);

  return fetch(url, {
    method: "PUT",
    headers: {
      Authorization: getAuthHeader(loginName, appPassword),
      "Content-Type": "text/plain",
    },
    body: content,
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
  });
};

const downloadFile = (server, loginName, appPassword, fileName) => {
  const url = getWebDavUrl(server, loginName, fileName);

  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(loginName, appPassword),
    },
  });
};

const fileExists = (server, loginName, appPassword, fileName) => {
  const url = getWebDavUrl(server, loginName, fileName);

  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(loginName, appPassword),
    },
  }).then((response) => response.ok);
};

export const useNextcloudAuthentication = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const { server, loginName, appPassword } = getCredentials();

    if (server && loginName && appPassword) {
      dispatch(
        updateNextcloudLogin({ ncLoggedIn: true, ncLoginLoading: false }),
      );
    } else {
      dispatch(updateNextcloudLogin({ ncLoginLoading: false }));
    }
  }, [dispatch]);
};

export const nextcloudLogin = ({ dispatch, serverUrl }) => {
  const normalizedServer = serverUrl.replace(/\/$/, "");

  dispatch(
    updateNextcloudLogin({
      ncLoginLoading: true,
      ncLoginError: false,
    }),
  );

  fetch(`${normalizedServer}/index.php/login/v2`, {
    method: "POST",
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Login flow init failed: ${response.status}`);
      }
      return response.json();
    })
    .then(({ login, poll }) => {
      loginPopup = window.open(login, "_blank", "width=900,height=700");

      let pollCount = 0;
      const MAX_POLLS = 150;

      pollInterval = setInterval(() => {
        pollCount++;

        if (pollCount > MAX_POLLS) {
          clearInterval(pollInterval);
          pollInterval = null;
          if (loginPopup && !loginPopup.closed) {
            loginPopup.close();
          }
          dispatch(
            updateNextcloudLogin({
              ncLoginLoading: false,
              ncLoginError: true,
            }),
          );
          return;
        }

        fetch(poll.endpoint, {
          method: "POST",
          body: new URLSearchParams({ token: poll.token }),
        })
          .then((response) => {
            if (response.status === 200) {
              return response.json().then(({ server, loginName, appPassword }) => {
                clearInterval(pollInterval);
                pollInterval = null;

                if (loginPopup && !loginPopup.closed) {
                  loginPopup.close();
                }

                localStorage.setItem("owb.nextcloud.server", server);
                localStorage.setItem("owb.nextcloud.loginName", loginName);
                localStorage.setItem("owb.nextcloud.appPassword", appPassword);

                dispatch(
                  updateNextcloudLogin({
                    ncLoggedIn: true,
                    ncLoginLoading: false,
                    ncLoginError: false,
                  }),
                );
              });
            }
            // 404 = still waiting, keep polling
          })
          .catch(() => {
            // network error during poll — keep trying
          });
      }, 2000);
    })
    .catch(() => {
      dispatch(
        updateNextcloudLogin({ ncLoginLoading: false, ncLoginError: true }),
      );
    });
};

export const nextcloudLogout = ({ dispatch }) => {
  localStorage.removeItem("owb.nextcloud.server");
  localStorage.removeItem("owb.nextcloud.loginName");
  localStorage.removeItem("owb.nextcloud.appPassword");

  dispatch(
    updateNextcloudLogin({
      ncLoggedIn: false,
      ncLoginError: false,
      ncSyncError: false,
      ncSyncConflict: false,
    }),
  );
};

export const uploadLocalDataToNextcloud = ({ dispatch, settings }) => {
  const { server, loginName, appPassword } = getCredentials();
  const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];

  uploadFile(
    server,
    loginName,
    appPassword,
    SYNC_FILE_PATH,
    settings.lastChanged,
  )
    .then(() =>
      uploadFile(
        server,
        loginName,
        appPassword,
        DATA_FILE_PATH,
        JSON.stringify({ lists: localLists, settings }),
      ),
    )
    .then(() => {
      dispatch(
        updateNextcloudLogin({ ncIsSyncing: false, ncSyncConflict: false }),
      );
      dispatch(updateSetting({ lastSynced: settings.lastChanged }));
      localStorage.setItem(
        "owb.settings",
        JSON.stringify({ ...settings, lastSynced: settings.lastChanged }),
      );
      ncIsSyncing = false;
    })
    .catch(() => {
      dispatch(
        updateNextcloudLogin({
          ncIsSyncing: false,
          ncSyncConflict: false,
          ncSyncError: true,
        }),
      );
      ncIsSyncing = false;
    });
};

export const downloadRemoteDataFromNextcloud = ({ dispatch }) => {
  const { server, loginName, appPassword } = getCredentials();

  downloadFile(server, loginName, appPassword, DATA_FILE_PATH)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      return response.text();
    })
    .then((text) => {
      const downloadedDataFile = JSON.parse(text);
      const newSettings = {
        ...downloadedDataFile.settings,
        lastSynced: downloadedDataFile.settings.lastChanged,
      };

      dispatch(setLists(downloadedDataFile.lists));
      dispatch(setSettings(newSettings));
      dispatch(
        updateNextcloudLogin({ ncIsSyncing: false, ncSyncConflict: false }),
      );
      ncIsSyncing = false;
      localStorage.setItem(
        "owb.lists",
        JSON.stringify(downloadedDataFile.lists),
      );
      localStorage.setItem("owb.settings", JSON.stringify(newSettings));
    })
    .catch(() => {
      dispatch(
        updateNextcloudLogin({
          ncIsSyncing: false,
          ncSyncConflict: false,
          ncSyncError: true,
        }),
      );
      ncIsSyncing = false;
    });
};

export const syncNextcloudLists = ({ dispatch }) => {
  const { server, loginName, appPassword } = getCredentials();
  const settings = JSON.parse(localStorage.getItem("owb.settings")) || {};

  if (ncIsSyncing || !server || !loginName || !appPassword) {
    return;
  }

  dispatch(updateNextcloudLogin({ ncIsSyncing: true, ncSyncError: false }));
  ncIsSyncing = true;

  const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];

  Promise.all([
    fileExists(server, loginName, appPassword, SYNC_FILE_PATH),
    fileExists(server, loginName, appPassword, DATA_FILE_PATH),
  ])
    .then(([syncExists, dataExists]) => {
      if (!syncExists || !dataExists) {
        const lastChanged = new Date().toString();
        const newSettings = { ...settings, lastChanged, lastSynced: lastChanged };

        Promise.all([
          uploadFile(server, loginName, appPassword, SYNC_FILE_PATH, lastChanged),
          uploadFile(
            server,
            loginName,
            appPassword,
            DATA_FILE_PATH,
            JSON.stringify({ lists: localLists, settings: newSettings }),
          ),
        ])
          .then(() => {
            dispatch(updateNextcloudLogin({ ncIsSyncing: false }));
            ncIsSyncing = false;
          })
          .catch(() => {
            dispatch(
              updateNextcloudLogin({ ncIsSyncing: false, ncSyncError: true }),
            );
            ncIsSyncing = false;
          });

        dispatch(
          updateSetting({
            lastChanged: newSettings.lastChanged,
            lastSynced: newSettings.lastSynced,
          }),
        );
        localStorage.setItem("owb.settings", JSON.stringify(newSettings));
      } else {
        downloadFile(server, loginName, appPassword, SYNC_FILE_PATH)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Sync file download failed: ${response.status}`);
            }
            return response.text();
          })
          .then((downloadedSyncFile) => {
            const remoteLastChanged = new Date(downloadedSyncFile).getTime();
            const localLastChanged =
              new Date(settings.lastChanged).getTime() || 0;
            const lastSynced = settings.lastSynced
              ? new Date(settings.lastSynced).getTime()
              : 0;

            let syncConflict = false;

            if (
              lastSynced < remoteLastChanged &&
              localLastChanged > remoteLastChanged
            ) {
              dispatch(
                updateNextcloudLogin({
                  ncSyncConflict: true,
                  ncIsSyncing: false,
                }),
              );
              syncConflict = true;
              ncIsSyncing = false;
            } else if (remoteLastChanged < localLastChanged) {
              uploadLocalDataToNextcloud({ dispatch, settings });
            } else if (remoteLastChanged > localLastChanged) {
              downloadRemoteDataFromNextcloud({ dispatch });
            } else {
              dispatch(updateNextcloudLogin({ ncIsSyncing: false }));
              ncIsSyncing = false;
            }

            if (!syncConflict) {
              dispatch(updateSetting({ lastSynced: settings.lastChanged }));
              localStorage.setItem(
                "owb.settings",
                JSON.stringify({
                  ...settings,
                  lastSynced: settings.lastChanged,
                }),
              );
            }
          })
          .catch(() => {
            dispatch(
              updateNextcloudLogin({ ncIsSyncing: false, ncSyncError: true }),
            );
            ncIsSyncing = false;
          });
      }
    })
    .catch(() => {
      dispatch(
        updateNextcloudLogin({
          ncIsSyncing: false,
          ncLoggedIn: false,
          ncLoginLoading: false,
        }),
      );
      ncIsSyncing = false;
      localStorage.removeItem("owb.nextcloud.server");
      localStorage.removeItem("owb.nextcloud.loginName");
      localStorage.removeItem("owb.nextcloud.appPassword");
    });
};
