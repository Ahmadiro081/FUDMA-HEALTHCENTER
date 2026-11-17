import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { DoctorDashboard } from './pages/DoctorDashboard';
import { LabDashboard } from './pages/LabDashboard';
import { LandingPage } from './pages/LandingPage';
import { NursingDashboard } from './pages/NursingDashboard';
import { PatientDashboard } from './pages/PatientDashboard';
import { PharmacyDashboard } from './pages/PharmacyDashboard';
import { SetupSuperAdminPage } from './pages/SetupSuperAdminPage';
import { StudentManagementPage } from './pages/StudentManagementPage';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin-login" element={<AdminLoginPage />} />
            <Route path="/setup-super-admin" element={<SetupSuperAdminPage />} />
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
                <ProtectedRoute allowedRoles={['nurse', 'admin', 'super_admin']}>
                  <NursingDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/doctor"
              element={
                <ProtectedRoute allowedRoles={['doctor', 'admin', 'super_admin']}>
                  <DoctorDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/laboratory"
              element={
                <ProtectedRoute allowedRoles={['lab', 'admin', 'super_admin']}>
                  <LabDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/pharmacy"
              element={
                <ProtectedRoute allowedRoles={['pharmacy', 'admin', 'super_admin']}>
                  <PharmacyDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/admin"
              element={
                <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/admin/student-management"
              element={
                <ProtectedRoute allowedRoles={['super_admin']}>
                  <StudentManagementPage />
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
