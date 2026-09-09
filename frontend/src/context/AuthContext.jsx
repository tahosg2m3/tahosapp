import { createContext, useContext, useState, useEffect } from 'react';
import { loginUser, registerUser, verifyToken } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // Kilitlenmeyi önleyen kalkan eklendi

  useEffect(() => {
    let isMounted = true;

    const restoreVoicesion = async () => {
      try {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('chat_token');
        if (!storedUser || !token || storedUser === 'undefined' || storedUser === 'null') return;

        // Yerel depodaki kullanıcı bilgisine körü körüne güvenmek yerine, her
        // uygulama açılışında imzalı and süresi geçmemiş token'ı doğruluyoruz.
        const response = await verifyToken();
        if (isMounted) setUser(response.user);
        localStorage.setItem('user', JSON.stringify(response.user));
      } catch (error) {
        console.warn('Could not verify the session:', error.message);
        localStorage.removeItem('user');
        localStorage.removeItem('chat_token');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    restoreVoicesion();
    return () => { isMounted = false; };
  }, []);

  const login = async (email, password) => {
    const response = await loginUser({ email, password });
    setUser(response.user);
    localStorage.setItem('user', JSON.stringify(response.user));
    localStorage.setItem('chat_token', response.token);
    return response.user; // Sayfa yenileme SİLİNDİ!
  };

  const register = async (username, email, password) => {
    const response = await registerUser({ username, email, password });
    setUser(response.user);
    localStorage.setItem('user', JSON.stringify(response.user));
    localStorage.setItem('chat_token', response.token);
    return response.user; // Sayfa yenileme SİLİNDİ!
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('chat_token');
  };

  const updateUserData = (newData) => {
    const updatedUser = { ...user, ...newData };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  useEffect(() => {
    if (!user?.theme) return;
    document.documentElement.dataset.theme = user.theme;
    localStorage.setItem('chat:theme', user.theme);
  }, [user?.theme]);

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateUserData }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
