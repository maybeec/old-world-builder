import { useState, useEffect } from "react";
import classNames from "classnames";
import PropTypes from "prop-types";
import { useLocation, Link, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "../../components/button";
import { Icon } from "../../components/icon";
import { Dialog } from "../../components/dialog";
import { updateLocalList } from "../../utils/list";
import {
  login,
  syncLists,
  uploadLocalDataToDropbox,
  downloadRemoteDataFromDropbox,
} from "../../utils/dropbox-auth-and-synchronization";
import {
  nextcloudLogin,
  nextcloudLogout,
  connectWithAppPassword,
  getNextcloudSettingsUrl,
  syncNextcloudLists,
  uploadLocalDataToNextcloud,
  downloadRemoteDataFromNextcloud,
} from "../../utils/nextcloud-auth-and-synchronization";
import { updateSetting } from "../../state/settings";
import { updateLogin } from "../../state/login";
import { updateNextcloudLogin } from "../../state/nextcloudLogin";

import "./Header.css";

export const Header = ({
  className,
  headline,
  headlineIcon,
  subheadline,
  moreButton,
  to,
  isSection,
  isPreview,
  hasPointsError,
  hasMainNavigation,
  navigationIcon,
  hasHomeButton,
  filters,
}) => {
  const intl = useIntl();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isNextcloudDialogOpen, setIsNextcloudDialogOpen] = useState(false);
  const [nextcloudServerUrl, setNextcloudServerUrl] = useState("");
  const [showAppPasswordForm, setShowAppPasswordForm] = useState(false);
  const [ncLoginName, setNcLoginName] = useState("");
  const [ncAppPassword, setNcAppPassword] = useState("");
  const dispatch = useDispatch();
  const { listId, unitId } = useParams();
  const { loginLoading, loggedIn, isSyncing, syncConflict, syncError } =
    useSelector((state) => state.login);
  const { ncLoggedIn, ncLoginLoading, ncCorsError, ncIsSyncing, ncSyncConflict, ncSyncError } =
    useSelector((state) => state.nextcloudLogin);
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id),
  );
  const settings = useSelector((state) => state.settings);
  const Component = isSection ? "section" : "header";
  const hasLocalChanges =
    new Date(settings.lastChanged).getTime() >
    new Date(settings.lastSynced).getTime();
  const isAnySyncing = isSyncing || ncIsSyncing;
  const isAnyLoggedIn = loggedIn || ncLoggedIn;
  const handleMenuClick = () => {
    setShowMenu(!showMenu);
  };
  const navigationLinks = [
    {
      name: intl.formatMessage({
        id: "footer.about",
      }),
      to: "/about",
      icon: "about",
    },
    {
      name: intl.formatMessage({
        id: "footer.help",
      }),
      to: "/help",
      icon: "help",
    },
    {
      name: intl.formatMessage({
        id: "footer.settings",
      }),
      to: "/settings",
      icon: "settings",
    },
    {
      name: intl.formatMessage({
        id: "footer.changelog",
      }),
      to: "/changelog",
      icon: "news",
    },
    {
      name: intl.formatMessage({
        id: "footer.custom-datasets",
      }),
      to: "/custom-datasets",
      icon: "datasets",
    },
  ];
  const navigation = hasMainNavigation ? navigationLinks : moreButton;
  const logout = () => {
    if (loggedIn) {
      localStorage.removeItem("owb.accessToken");
      localStorage.removeItem("owb.refreshToken");
      dispatch(updateLogin({ loggedIn: false }));
    } else if (ncLoggedIn) {
      nextcloudLogout({ dispatch });
    }
    setIsDialogOpen(false);
  };

  const resetNextcloudDialog = () => {
    setNextcloudServerUrl("");
    setShowAppPasswordForm(false);
    setNcLoginName("");
    setNcAppPassword("");
    dispatch(updateNextcloudLogin({ ncLoginError: false, ncCorsError: false }));
  };

  const closeNextcloudDialog = () => {
    setIsNextcloudDialogOpen(false);
    resetNextcloudDialog();
  };

  const handleNextcloudConnect = () => {
    if (!nextcloudServerUrl.trim()) return;

    if (showAppPasswordForm) {
      if (!ncLoginName.trim() || !ncAppPassword.trim()) return;
      connectWithAppPassword({
        dispatch,
        serverUrl: nextcloudServerUrl.trim(),
        loginName: ncLoginName.trim(),
        appPassword: ncAppPassword.trim(),
      });
      setIsNextcloudDialogOpen(false);
      resetNextcloudDialog();
      return;
    }

    // Try Login Flow v2 first (works on any Nextcloud with CORS configured).
    // On failure the dialog stays open and reveals the app-password form.
    nextcloudLogin({
      dispatch,
      serverUrl: nextcloudServerUrl.trim(),
      onSuccess: () => {
        // Popup opened — close the dialog so it doesn't obscure the popup
        setIsNextcloudDialogOpen(false);
        resetNextcloudDialog();
      },
      onError: () => {
        // CORS blocked or popup blocked — stay in dialog, show manual fallback
        setShowAppPasswordForm(true);
      },
    });
  };

  useEffect(() => {
    setShowMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    const updatedList = JSON.stringify(list);
    const localList = JSON.stringify(
      JSON.parse(localStorage.getItem("owb.lists") || "[]").find(
        (localList) => localList.id === listId,
      ),
    );

    if (list && updatedList !== localList) {
      updateLocalList(list);

      const newSettings = { ...settings, lastChanged: new Date().toString() };
      dispatch(updateSetting({ lastChanged: newSettings.lastChanged }));
      localStorage.setItem("owb.settings", JSON.stringify(newSettings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return (
    <>
      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <p>
          <FormattedMessage id="header.confirmLogout" />
        </p>
        <div className="editor__delete-dialog">
          <Button
            type="text"
            onClick={() => setIsDialogOpen(false)}
            icon="close"
            spaceTop
            color="dark"
          >
            <FormattedMessage id="misc.cancel" />
          </Button>
          <Button
            type="primary"
            submitButton
            onClick={logout}
            icon="logout"
            spaceTop
          >
            <FormattedMessage id={ncLoggedIn ? "header.nextcloudLogout" : "header.dropboxLogout"} />
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={isNextcloudDialogOpen}
        onClose={closeNextcloudDialog}
      >
        <p>
          <FormattedMessage id="header.nextcloudServerUrl" />
        </p>
        <input
          type="url"
          className="input"
          value={nextcloudServerUrl}
          onChange={(e) => {
            setNextcloudServerUrl(e.target.value);
            setShowAppPasswordForm(false);
            dispatch(updateNextcloudLogin({ ncLoginError: false, ncCorsError: false }));
          }}
          onKeyDown={(e) => { if (e.key === "Enter") handleNextcloudConnect(); }}
          placeholder="https://cloud.example.com"
          disabled={ncLoginLoading}
        />
        {ncCorsError && (
          <div className="header__nc-cors-error">
            <p className="header__nc-error">
              <FormattedMessage id="header.nextcloudCorsError" />
            </p>
            <pre className="header__nc-cors-config">{`# nginx — inside your Nextcloud server {} block:
add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS, MKCOL, PROPFIND' always;
add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, Depth' always;
if ($request_method = OPTIONS) { return 204; }

# Apache2 — inside your Nextcloud VirtualHost:
<IfModule mod_headers.c>
  Header always set Access-Control-Allow-Origin "*"
  Header always set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, MKCOL, PROPFIND"
  Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth"
</IfModule>
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_METHOD} OPTIONS
  RewriteRule .* - [R=200,L]
</IfModule>`}</pre>
          </div>
        )}
        {showAppPasswordForm && (
          <>
            <p className="header__nc-hint">
              <FormattedMessage id="header.nextcloudAppPasswordHint" />{" "}
              <a
                href={getNextcloudSettingsUrl(nextcloudServerUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FormattedMessage id="header.nextcloudOpenSettings" />
              </a>
            </p>
            <input
              type="text"
              className="input"
              value={ncLoginName}
              onChange={(e) => setNcLoginName(e.target.value)}
              placeholder={intl.formatMessage({ id: "header.nextcloudLoginName" })}
              autoComplete="username"
            />
            <input
              type="password"
              className="input"
              value={ncAppPassword}
              onChange={(e) => setNcAppPassword(e.target.value)}
              placeholder={intl.formatMessage({ id: "header.nextcloudAppPassword" })}
              autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === "Enter") handleNextcloudConnect(); }}
            />
          </>
        )}
        <div className="editor__delete-dialog">
          <Button
            type="text"
            onClick={closeNextcloudDialog}
            icon="close"
            spaceTop
            color="dark"
          >
            <FormattedMessage id="misc.cancel" />
          </Button>
          <Button
            type="primary"
            icon={ncLoginLoading ? "spinner" : "nextcloud"}
            spaceTop
            disabled={
              ncLoginLoading ||
              !nextcloudServerUrl.trim() ||
              (showAppPasswordForm && (!ncLoginName.trim() || !ncAppPassword.trim()))
            }
            onClick={handleNextcloudConnect}
          >
            <FormattedMessage id={showAppPasswordForm ? "header.nextcloudAppPasswordConnect" : "header.nextcloudLogin"} />
          </Button>
        </div>
      </Dialog>

      <Component
        className={classNames(
          isSection ? "column-header" : "header",
          className,
        )}
      >
        {to ? (
          <Button
            type="text"
            to={to}
            label={
              isSection
                ? intl.formatMessage({ id: "header.close" })
                : intl.formatMessage({ id: "header.back" })
            }
            color={isSection ? "dark" : "light"}
            icon={isSection ? "close" : "back"}
            showLabelRight={!isSection}
          />
        ) : (
          <>
            {hasHomeButton && (
              <Button
                type="text"
                to="/"
                label={intl.formatMessage({ id: "misc.startpage" })}
                color="light"
                icon="home"
                showLabelRight
              />
            )}
            {!hasHomeButton && !isPreview && (
              <>
                {loggedIn ? (
                  <Button
                    type="text"
                    onClick={() => setIsDialogOpen(true)}
                    label={intl.formatMessage({ id: "header.dropboxLogout" })}
                    color="light"
                    icon="logout"
                    showLabelRight
                  />
                ) : ncLoggedIn ? (
                  <Button
                    type="text"
                    onClick={() => setIsDialogOpen(true)}
                    label={intl.formatMessage({ id: "header.nextcloudLogout" })}
                    color="light"
                    icon="logout"
                    showLabelRight
                  />
                ) : (
                  <div className="header__login-buttons">
                    {loginLoading ? (
                      <Button
                        type="text"
                        label={intl.formatMessage({ id: "header.dropboxLogin" })}
                        color="light"
                        icon="spinner"
                      />
                    ) : (
                      <Button
                        type="text"
                        onClick={() => login({ dispatch })}
                        label={intl.formatMessage({ id: "header.dropboxLogin" })}
                        color="light"
                        icon="dropbox"
                        showLabelRight
                      />
                    )}
                    {ncLoginLoading ? (
                      <Button
                        type="text"
                        label={intl.formatMessage({ id: "header.nextcloudLogin" })}
                        color="light"
                        icon="spinner"
                      />
                    ) : (
                      <Button
                        type="text"
                        onClick={() => setIsNextcloudDialogOpen(true)}
                        label={intl.formatMessage({ id: "header.nextcloudLogin" })}
                        color="light"
                        icon="nextcloud"
                        showLabelRight
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div className="header__text">
          {headline && (
            <>
              {headline === "Old World Builder" ? (
                <h1 className="header__name">
                  <Link className="header__name-link" to="/">
                    {headline}
                  </Link>
                  {!isSection && (
                    <>
                      {isAnyLoggedIn ? (
                        <>
                          <Button
                            type="text"
                            color="light"
                            className="header__cloud-icon"
                            label={intl.formatMessage({ id: "header.sync" })}
                            icon={
                              isAnySyncing
                                ? "sync"
                                : hasLocalChanges
                                ? "cloud-upload"
                                : "cloud"
                            }
                            disabled={isAnySyncing}
                            onClick={() => {
                              if (ncLoggedIn) {
                                syncNextcloudLists({ dispatch });
                              } else {
                                syncLists({ dispatch });
                              }
                            }}
                          />
                          {(syncError || ncSyncError) && (
                            ncCorsError ? (
                              <span
                                className="header__sync-error header__sync-error--clickable"
                                onClick={() => setIsNextcloudDialogOpen(true)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setIsNextcloudDialogOpen(true); }}
                              >
                                <Icon symbol="error" color="red" />
                              </span>
                            ) : (
                              <Icon
                                symbol="error"
                                color="red"
                                className="header__sync-error"
                              />
                            )
                          )}
                        </>
                      ) : (
                        <Button
                          type="text"
                          color="light"
                          className="header__cloud-icon"
                          disabled
                          icon="cloud-off"
                        />
                      )}
                    </>
                  )}
                </h1>
              ) : (
                <h1 className="header__name">
                  {headlineIcon && headlineIcon}
                  <span className="header__name-text">{headline}</span>
                </h1>
              )}
            </>
          )}
          {subheadline && (
            <p className="header__points">
              {subheadline}{" "}
              {hasPointsError && <Icon symbol="error" color="red" />}
              {!isSection && (
                <>
                  {isAnyLoggedIn ? (
                    <Button
                      type="text"
                      color="light"
                      className="header__cloud-icon"
                      label={intl.formatMessage({ id: "header.sync" })}
                      icon={
                        isAnySyncing
                          ? "sync"
                          : hasLocalChanges
                          ? "cloud-upload"
                          : "cloud"
                      }
                      disabled={isAnySyncing}
                      onClick={() => {
                        if (ncLoggedIn) {
                          syncNextcloudLists({ dispatch });
                        } else {
                          syncLists({ dispatch });
                        }
                      }}
                    />
                  ) : (
                    <Button
                      type="text"
                      color="light"
                      className="header__cloud-icon"
                      disabled
                      icon="cloud-off"
                    />
                  )}
                </>
              )}
            </p>
          )}
        </div>
        {navigation ? (
          <Button
            type="text"
            className={classNames(showMenu && "header__more-button")}
            color={isSection ? "dark" : "light"}
            label={
              navigationIcon
                ? unitId
                  ? intl.formatMessage({ id: "header.moreUnit" })
                  : intl.formatMessage({ id: "header.moreList" })
                : intl.formatMessage({ id: "header.menu" })
            }
            icon={navigationIcon ? navigationIcon : "menu"}
            onClick={handleMenuClick}
            showLabelLeft={!isSection}
          />
        ) : (
          <>
            {to && !filters && (
              <div
                className={classNames(
                  "header__empty-icon",
                  isSection && "header__empty-icon--small",
                )}
              />
            )}
          </>
        )}
        {filters && (
          <Button
            type="text"
            className={classNames(showMenu && "header__more-button")}
            color={isSection ? "dark" : "light"}
            label={intl.formatMessage({ id: "header.filter" })}
            icon="filter"
            onClick={handleMenuClick}
            showLabelLeft
          />
        )}
        {showMenu && navigation && (
          <ul
            className={classNames(
              "header__more",
              !hasMainNavigation && "header__more--secondary-navigation",
            )}
          >
            {navigation.map(
              ({ callback, name, icon, to: moreButtonTo, closeOnClick }) => (
                <li key={name}>
                  <Button
                    type="text"
                    onClick={() => {
                      callback && callback();

                      if (closeOnClick) {
                        setShowMenu(false);
                      }
                    }}
                    to={moreButtonTo}
                    icon={icon}
                  >
                    {name}
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        {showMenu && filters && (
          <ul
            className={classNames(
              "header__more",
              !hasMainNavigation && "header__more--secondary-navigation",
            )}
          >
            {/*
             * Can't add <InstallPwa /> here, as it needs to be rendered
             * on page load to catch the beforeinstallprompt event.
             */}
            {filters.map(({ callback, name, description, id, checked }) => (
              <li key={id}>
                <div className="checkbox header__checkbox">
                  <input
                    type="checkbox"
                    id={id}
                    onChange={callback}
                    checked={checked}
                    className="checkbox__input"
                  />
                  <label htmlFor={id} className="checkbox__label">
                    {name}
                  </label>
                </div>
                {description && (
                  <i className="header__filter-description">{description}</i>
                )}
              </li>
            ))}
          </ul>
        )}
        {!isSection && syncConflict && (
          <Dialog open={syncConflict}>
            <p>
              <FormattedMessage id="header.syncConflict" />
            </p>
            <div className="header__sync-conflict-buttons">
              <Button
                type="primary"
                icon="cloud-upload"
                spaceTop
                autoHeight
                onClick={() => {
                  uploadLocalDataToDropbox({ dispatch, settings });
                  dispatch(
                    updateLogin({ isSyncing: true, syncConflict: false }),
                  );
                }}
              >
                <FormattedMessage id="header.useLocal" />
              </Button>
              <Button
                type="primary"
                icon="cloud-download"
                spaceTop
                autoHeight
                onClick={() => {
                  downloadRemoteDataFromDropbox({ dispatch });
                  dispatch(
                    updateLogin({ isSyncing: true, syncConflict: false }),
                  );
                }}
              >
                <FormattedMessage id="header.useRemote" />
              </Button>
              <Button
                type="text"
                icon="close"
                color="dark"
                spaceTop
                onClick={() => {
                  dispatch(updateLogin({ syncConflict: false }));
                }}
              >
                <FormattedMessage id="misc.cancel" />
              </Button>
            </div>
          </Dialog>
        )}
        {!isSection && ncSyncConflict && (
          <Dialog open={ncSyncConflict}>
            <p>
              <FormattedMessage id="header.syncConflict" />
            </p>
            <div className="header__sync-conflict-buttons">
              <Button
                type="primary"
                icon="cloud-upload"
                spaceTop
                autoHeight
                onClick={() => {
                  uploadLocalDataToNextcloud({ dispatch, settings });
                  dispatch(
                    updateNextcloudLogin({
                      ncIsSyncing: true,
                      ncSyncConflict: false,
                    }),
                  );
                }}
              >
                <FormattedMessage id="header.useLocal" />
              </Button>
              <Button
                type="primary"
                icon="cloud-download"
                spaceTop
                autoHeight
                onClick={() => {
                  downloadRemoteDataFromNextcloud({ dispatch });
                  dispatch(
                    updateNextcloudLogin({
                      ncIsSyncing: true,
                      ncSyncConflict: false,
                    }),
                  );
                }}
              >
                <FormattedMessage id="header.useRemote" />
              </Button>
              <Button
                type="text"
                icon="close"
                color="dark"
                spaceTop
                onClick={() => {
                  dispatch(updateNextcloudLogin({ ncSyncConflict: false }));
                }}
              >
                <FormattedMessage id="misc.cancel" />
              </Button>
            </div>
          </Dialog>
        )}
      </Component>
    </>
  );
};

Header.propTypes = {
  className: PropTypes.string,
  to: PropTypes.string,
  headline: PropTypes.string,
  headlineIcon: PropTypes.node,
  subheadline: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  children: PropTypes.node,
  moreButton: PropTypes.array,
  filters: PropTypes.array,
  isSection: PropTypes.bool,
  hasPointsError: PropTypes.bool,
  hasMainNavigation: PropTypes.bool,
  hasHomeButton: PropTypes.bool,
  navigationIcon: PropTypes.string,
};
