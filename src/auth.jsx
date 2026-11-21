import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, SIGNED_OUT_EVENT } from './api.js';

const AuthContext = createContext(null);

/** Holds the signed-in store (user). `user` is undefined while checking a saved session. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? undefined : null));

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const onSignedOut = () => setUser(null);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  const signIn = useCallback(({ token, user: u }) => {
    setToken(token);
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
