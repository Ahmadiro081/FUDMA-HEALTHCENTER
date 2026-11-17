import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AdminDashboard } from './pages/AdminDashboard';
import { LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { DoctorDashboard } from './pages/DoctorDashboard';
import { LabDashboard } from './pages/LabDashboard';
import { LandingPage } from './pages/LandingPage';
import { NursingDashboard } from './pages/NursingDashboard';
import { PatientDashboard } from './pages/PatientDashboard';
import { PharmacyDashboard } from './pages/PharmacyDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route
              path="/portal/patient"
              element={
                <ProtectedRoute allowedRoles={['patient']}>
                  <PatientDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/nursing"
              element={
                <ProtectedRoute allowedRoles={['nurse', 'admin']}>
                  <NursingDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/doctor"
              element={
                <ProtectedRoute allowedRoles={['doctor', 'admin']}>
                  <DoctorDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/laboratory"
              element={
                <ProtectedRoute allowedRoles={['lab', 'admin']}>
                  <LabDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/pharmacy"
              element={
                <ProtectedRoute allowedRoles={['pharmacy', 'admin']}>
                  <PharmacyDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
