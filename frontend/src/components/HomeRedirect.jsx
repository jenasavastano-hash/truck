import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Login from '../pages/Login';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';

/**
 * Компонент для главной страницы "/"
 * Если пользователь не залогинен - показывает страницу входа
 * Если залогинен - редиректит на соответствующую страницу по роли
 */
export default function HomeRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (loading) return; // Ждем загрузки данных авторизации
    
    // Предотвращаем множественные редиректы
    if (hasRedirected.current) return;
    
    if (user) {
      hasRedirected.current = true;
      // Пользователь залогинен - редиректим по роли
      switch (user.role) {
        case 'admin':
          navigate('/admin', { replace: true });
          break;
        case 'manager':
          navigate('/manager', { replace: true });
          break;
        case 'driver':
          navigate('/driver', { replace: true });
          break;
        case 'evacuator':
          navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/evacuator' : '/home', { replace: true });
          break;
        case 'commissioner':
          navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/commissioner' : '/home', { replace: true });
          break;
        default:
          // Если роль неизвестна, показываем страницу входа
          navigate('/login', { replace: true });
      }
    }
    // Если user === null, просто показываем Login (ничего не делаем)
  }, [user, loading, navigate]);

  // Показываем загрузку пока проверяем авторизацию
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Загрузка...</p>
        </div>
      </div>
    );
  }

  // Если пользователь не залогинен - показываем страницу входа
  if (!user) {
    return <Login />;
  }

  // Если пользователь залогинен, но редирект еще не произошел - показываем загрузку
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-600 font-medium">Перенаправление...</p>
      </div>
    </div>
  );
}
