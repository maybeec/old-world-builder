import { useEffect } from "react";
import { useDispatch } from "react-redux";

import { updateNextcloudLogin } from "../state/nextcloudLogin";
import { setSettings, updateSetting } from "../state/settings";
import { setLists } from "../state/lists";

const NC_FOLDER = "old-world-builder";
const DATA_FILE_PATH = `${NC_FOLDER}/owb-data.json`;
const SYNC_FILE_PATH = `${NC_FOLDER}/owb-sync.txt`;

let ncIsSyncing = false;
let pollInterval = null;
let loginPopup = null;

const getCredentials = () => ({
  server: localStorage.getItem("owb.nextcloud.server"),
  loginName: localStorage.getItem("owb.nextcloud.loginName"),
  appPassword: localStorage.getItem("owb.nextcloud.appPassword"),
});

// btoa() only handles Latin1 — encode via TextEncoder for full Unicode safety
const getAuthHeader = (loginName, appPassword) => {
  const bytes = new TextEncoder().encode(`${loginName}:${appPassword}`);
  const binary = String.fromCharCode(...bytes);
  return "Basic " + btoa(binary);
};

const getWebDavUrl = (server, loginName, fileName) =>
  `${server}/remote.php/dav/files/${encodeURIComponent(loginName)}/${fileName}`;

const ensureFolder = (server, loginName, appPassword) => {
  const url = getWebDavUrl(server, loginName, NC_FOLDER);

  return fetch(url, {
    method: "MKCOL",
    headers: {
      Authorization: getAuthHeader(loginName, appPassword),
    },
  }).then(() => {
    // 201 = created, 405 = already exists — both are fine
  });
};

const uploadFile = (server, loginName, appPassword, fileName, content) => {
  const url = getWebDavUrl(server, loginName, fileName);
  const contentType = fileName.endsWith(".json")
    ? "application/json"
    : "text/plain";

  return fetch(url, {
    method: "PUT",
    headers: {
      Authorization: getAuthHeader(loginName, appPassword),
      "Content-Type": contentType,
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

const normalizeServerUrl = (serverUrl) => {
  const trimmed = serverUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

export const connectWithAppPassword = ({ dispatch, serverUrl, loginName, appPassword }) => {
  const server = normalizeServerUrl(serverUrl);

  localStorage.setItem("owb.nextcloud.server", server);
  localStorage.setItem("owb.nextcloud.loginName", loginName.trim());
  localStorage.setItem("owb.nextcloud.appPassword", appPassword.trim());

  dispatch(
    updateNextcloudLogin({
      ncLoggedIn: true,
      ncLoginLoading: false,
      ncLoginError: false,
    }),
  );
};

export const nextcloudLogin = ({ dispatch, serverUrl, onPopupOpen }) => {
  const normalizedServer = normalizeServerUrl(serverUrl);
  // Clear any leftover poll from a previous login attempt
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (loginPopup && !loginPopup.closed) {
    loginPopup.close();
  }

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

      if (!loginPopup) {
        // Browser blocked the popup — inform user immediately
        dispatch(
          updateNextcloudLogin({ ncLoginLoading: false, ncLoginError: true }),
        );
        return;
      }

      // Popup opened — let the caller close the server-URL dialog
      onPopupOpen?.();

      let pollCount = 0;
      const MAX_POLLS = 150;

      pollInterval = setInterval(() => {
        // Stop polling if user closed the popup before completing auth
        if (loginPopup && loginPopup.closed) {
          clearInterval(pollInterval);
          pollInterval = null;
          dispatch(
            updateNextcloudLogin({ ncLoginLoading: false, ncLoginError: false }),
          );
          return;
        }

        if (++pollCount > MAX_POLLS) {
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
              return response
                .json()
                .then(({ server, loginName, appPassword }) => {
                  clearInterval(pollInterval);
                  pollInterval = null;

                  if (loginPopup && !loginPopup.closed) {
                    loginPopup.close();
                  }

                  localStorage.setItem("owb.nextcloud.server", server);
                  localStorage.setItem("owb.nextcloud.loginName", loginName);
                  localStorage.setItem(
                    "owb.nextcloud.appPassword",
                    appPassword,
                  );

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
            // transient network error during poll — keep trying
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

  Promise.all([
    uploadFile(server, loginName, appPassword, SYNC_FILE_PATH, settings.lastChanged),
    uploadFile(
      server,
      loginName,
      appPassword,
      DATA_FILE_PATH,
      JSON.stringify({ lists: localLists, settings }),
    ),
  ])
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

  // Download sync file — if 404 this is the first sync, otherwise use the content directly
  // (avoids a separate existence-check request and the double-download that would cause)
  downloadFile(server, loginName, appPassword, SYNC_FILE_PATH)
    .then((response) => {
      if (response.status === 404) {
        // First sync: create folder and upload both files
        const localLists = JSON.parse(localStorage.getItem("owb.lists")) || [];
        const lastChanged = new Date().toString();
        const newSettings = { ...settings, lastChanged, lastSynced: lastChanged };

        return ensureFolder(server, loginName, appPassword)
          .catch(() => {
            // non-fatal: folder may already exist
          })
          .then(() =>
            Promise.all([
              uploadFile(server, loginName, appPassword, SYNC_FILE_PATH, lastChanged),
              uploadFile(
                server,
                loginName,
                appPassword,
                DATA_FILE_PATH,
                JSON.stringify({ lists: localLists, settings: newSettings }),
              ),
            ]),
          )
          .then(() => {
            // Only update timestamps after confirmed upload
            dispatch(
              updateSetting({
                lastChanged: newSettings.lastChanged,
                lastSynced: newSettings.lastSynced,
              }),
            );
            localStorage.setItem("owb.settings", JSON.stringify(newSettings));
            dispatch(updateNextcloudLogin({ ncIsSyncing: false }));
            ncIsSyncing = false;
          });
      }

      if (!response.ok) {
        throw new Error(`Sync file fetch failed: ${response.status}`);
      }

      return response.text();
    })
    .then((syncContent) => {
      // syncContent is undefined when coming from the 404 branch (already handled above)
      if (syncContent === undefined) {
        return;
      }

      const remoteLastChanged = new Date(syncContent).getTime();
      const localLastChanged = new Date(settings.lastChanged).getTime() || 0;
      const lastSynced = settings.lastSynced
        ? new Date(settings.lastSynced).getTime()
        : 0;

      let syncConflict = false;

      if (
        lastSynced < remoteLastChanged &&
        localLastChanged > remoteLastChanged
      ) {
        dispatch(
          updateNextcloudLogin({ ncSyncConflict: true, ncIsSyncing: false }),
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
          JSON.stringify({ ...settings, lastSynced: settings.lastChanged }),
        );
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
