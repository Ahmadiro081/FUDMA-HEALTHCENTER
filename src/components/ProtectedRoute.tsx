import React from 'react';
import { Navigate } from 'react-router-dom';
import { getRoleDashboardPath, useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/hospital';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-sky-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600">Verifying clinical session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleDashboardPath(user.role)} replace />;
  }

  return <>{children}</>;
}
