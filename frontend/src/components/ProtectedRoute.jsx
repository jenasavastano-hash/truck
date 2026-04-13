import React, { useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    // Принудительная смена пароля: не пускаем дальше, пока не сменит
    if ((user.mustChangePassword || user.firstLogin) && location.pathname !== '/change-credentials') {
      navigate('/change-credentials');
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      navigate('/');
    }
  }, [user, loading, navigate, allowedRoles, location.pathname]);

  if (loading) {
    return <div className="text-center py-8">Загрузка...</div>;
  }

  if (!user) {
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    return null;
  }

  return children;
};

export default ProtectedRoute;
