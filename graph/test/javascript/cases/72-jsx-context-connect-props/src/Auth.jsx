import { createContext, useCallback, useContext, useMemo } from 'react';

export const AuthCtx = createContext(null);
export const ThemeCtx = createContext({ toggle: () => 'default-toggle' });

export function AuthProvider({ children }) {
  const logout = () => 'out';
  return <AuthCtx.Provider value={{ logout }}>{children}</AuthCtx.Provider>;
}

export function ThemeProvider({ children }) {
  const toggle = useCallback(() => 'dark', []);
  return <ThemeCtx value={useMemo(() => ({ toggle }), [toggle])}>{children}</ThemeCtx>;
}

// context in the same file, destructured
export function LogoutButton() {
  const { logout } = useContext(AuthCtx);
  return <button onClick={logout}>out</button>;
}

// a hook that returns the context value
export const useAuth = () => useContext(AuthCtx);

// the render-prop consumer
export function LogoutLink() {
  return <AuthCtx.Consumer>{(auth) => <a onClick={auth.logout}>out</a>}</AuthCtx.Consumer>;
}

// CONTROL: another context — its `logout` is not AuthCtx's, only toggle (and the default) are here
export function ThemeButton() {
  const { toggle, logout } = useContext(ThemeCtx);
  return <button onClick={toggle} onBlur={logout}>theme</button>;
}
