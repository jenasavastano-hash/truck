import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from './config/features';
import { AuthProvider, useAuth } from './AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import Header from './components/Header';
import ChangeCredentials from './pages/ChangeCredentials';
import ProtectedRoute from './components/ProtectedRoute';
import HomeRedirect from './components/HomeRedirect';
import Home from './pages/Home';
import Login from './pages/Login';
import AdminPanel from './pages/AdminPanel';
import ManagerPanel from './pages/ManagerPanel';
import DirectorPanel from './pages/DirectorPanel';
import DriverPortal from './pages/DriverPortal';
import DriverMessages from './pages/DriverMessages';
import DriverGamePage from './pages/DriverGamePage';
import EPLDetails from './pages/EPLDetails';
import EPLQRFullScreen from './pages/EPLQRFullScreen';
import BalanceTopup from './pages/BalanceTopup';
import DriverPhotoControl from './pages/DriverPhotoControl';
import DriverPhotoControlApplication from './pages/DriverPhotoControlApplication';
import DriverEvacuator from './pages/DriverEvacuator';
import EvacuatorPortal from './pages/EvacuatorPortal';
import EvacuatorBalanceTopup from './pages/EvacuatorBalanceTopup';
import DriverCommissioner from './pages/DriverCommissioner';
import CommissionerPortal from './pages/CommissionerPortal';
import CommissionerBalanceTopup from './pages/CommissionerBalanceTopup';

function ConditionalHeader() {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (location.pathname === '/login') {
    return null;
  }

  // Если еще идет загрузка, не показываем хедер
  if (loading) {
    return null;
  }

  // Скрываем Header для водителя, менеджера и админа (у них свои хедеры)
  if (
    (user?.role === 'driver' && location.pathname.startsWith('/driver')) ||
    (FEATURE_EVACUATOR_AND_COMMISSIONER &&
      user?.role === 'evacuator' &&
      location.pathname.startsWith('/evacuator')) ||
    (FEATURE_EVACUATOR_AND_COMMISSIONER &&
      user?.role === 'commissioner' &&
      location.pathname.startsWith('/commissioner')) ||
    (user?.role === 'manager' && location.pathname.startsWith('/manager')) ||
    (user?.role === 'director' && location.pathname.startsWith('/director')) ||
    (user?.role === 'admin' && location.pathname.startsWith('/admin'))
  ) {
    return null;
  }
  return <Header />;
}

function AppContent() {
  const location = useLocation();
  const loginRoute = location.pathname === '/login';

  return (
    <>
      <ConditionalHeader />
      <main className={loginRoute ? 'login-route-main' : undefined}>
        <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/home" element={<Home />} />
            <Route path="/change-credentials" element={<ChangeCredentials />} />
            
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminPanel />
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/manager"
              element={
                <ProtectedRoute allowedRoles={['manager']}>
                  <ManagerPanel />
                </ProtectedRoute>
              }
            />

            <Route
              path="/director"
              element={
                <ProtectedRoute allowedRoles={['director']}>
                  <DirectorPanel />
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/driver"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <DriverPortal />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/messages"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <DriverMessages />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/game"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <DriverGamePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/epl/:eplId/qr"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <EPLQRFullScreen />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/epl/:eplId"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <EPLDetails />
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/driver/balance-topup"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <BalanceTopup />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/photo-control"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <DriverPhotoControl />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/photo-control/:id"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  <DriverPhotoControlApplication />
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/evacuator"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  {FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                    <DriverEvacuator />
                  ) : (
                    <Navigate to="/driver" replace />
                  )}
                </ProtectedRoute>
              }
            />
            <Route
              path="/driver/commissioner"
              element={
                <ProtectedRoute allowedRoles={['driver']}>
                  {FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                    <DriverCommissioner />
                  ) : (
                    <Navigate to="/driver" replace />
                  )}
                </ProtectedRoute>
              }
            />
            <Route
              path="/evacuator"
              element={
                FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                  <ProtectedRoute allowedRoles={['evacuator']}>
                    <EvacuatorPortal />
                  </ProtectedRoute>
                ) : (
                  <Navigate to="/home" replace />
                )
              }
            />
            <Route
              path="/evacuator/balance-topup"
              element={
                FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                  <ProtectedRoute allowedRoles={['evacuator']}>
                    <EvacuatorBalanceTopup />
                  </ProtectedRoute>
                ) : (
                  <Navigate to="/home" replace />
                )
              }
            />
            <Route
              path="/commissioner"
              element={
                FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                  <ProtectedRoute allowedRoles={['commissioner']}>
                    <CommissionerPortal />
                  </ProtectedRoute>
                ) : (
                  <Navigate to="/home" replace />
                )
              }
            />
            <Route
              path="/commissioner/balance-topup"
              element={
                FEATURE_EVACUATOR_AND_COMMISSIONER ? (
                  <ProtectedRoute allowedRoles={['commissioner']}>
                    <CommissionerBalanceTopup />
                  </ProtectedRoute>
                ) : (
                  <Navigate to="/home" replace />
                )
              }
            />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
