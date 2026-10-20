import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loginUser, registerUser } from '../api.js';

const AuthContext = createContext(null);

const TOKEN_KEY = 'dermascan_token';
const USER_KEY = 'dermascan_user';

// Holds the authenticated user + JWT, persisted in localStorage so a page
// reload keeps the session alive.
export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }, [user]);

  const persistAuth = (authPayload) => {
    // Backends differ slightly; accept a few common shapes.
    const t = authPayload?.token || authPayload?.accessToken;
    const u = authPayload?.user || authPayload?.data?.user || null;
    setToken(t || null);
    setUser(u);
  };

  const login = useCallback(async (email, password) => {
    const payload = await loginUser(email, password);
    persistAuth(payload);
    return payload;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const payload = await registerUser(name, email, password);
    persistAuth(payload);
    return payload;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    token,
    user,
    isAuthenticated: Boolean(token),
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
