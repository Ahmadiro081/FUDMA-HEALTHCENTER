import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Cross,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { getRoleDashboardPath, getRoleLabel, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function AdminLoginPage() {
  const { user, loading, authMode, loginAdmin, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState('');

  if (!loading && user?.role === 'super_admin' && !submitting) {
    return <Navigate to="/portal/admin" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = identifier.trim();
    if (!trimmed || !password) {
      setError('Please enter your administrator email (or username) and password.');
      return;
    }
    setSubmitting(true);
    try {
      const signedAdmin = await loginAdmin(trimmed, password);
      showToast(`Authorized: ${signedAdmin.full_name}`, 'success');
      navigate('/portal/admin', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Administrator authentication failed. Access denied.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOutToSwitch = async () => {
    setSwitchingAccount(true);
    setError('');
    try {
      await logout();
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-4xl w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F4C81]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to FUDMA HEALTHCENTER Home</span>
          </Link>
          <Link
            to="/login"
            className="text-xs font-medium text-slate-600 hover:text-[#0F4C81] hover:underline"
          >
            Patient &amp; Clinical Staff Sign In
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0369A1]">
                  FUDMA HEALTHCENTER · Hospital Governance
                </p>
                <h1 className="text-xl font-bold text-slate-900">
                  Super Administrator Sign In
                </h1>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              Restricted executive authentication for hospital system governance. Sign-in verifies
              your credentials via Supabase Auth and confirms an active{' '}
              <code className="font-mono text-[11px] text-slate-800">super_admin</code> role in
              the database before granting console access.
            </p>

            {authMode === 'unconfigured' && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                Production Supabase authentication is not configured. Add{' '}
                <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable
                administrator sign in.
              </div>
            )}

            {!loading && user && user.role !== 'super_admin' && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-3"
              >
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-950">
                      Unauthorized Active Session ({getRoleLabel(user.role)})
                    </p>
                    <p className="mt-1 text-red-800 leading-relaxed">
                      You are currently signed in as{' '}
                      <span className="font-medium">{user.email}</span>. Patient, student, and
                      non-super-admin staff accounts cannot access the Super Administrator console.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <Link
                    to={getRoleDashboardPath(user.role)}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Return to {getRoleLabel(user.role)}
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOutToSwitch}
                    disabled={switchingAccount}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{switchingAccount ? 'Signing Out...' : 'Sign Out & Switch Account'}</span>
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 flex items-start gap-2"
              >
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="admin-login-identifier"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Administrator Email or Username
                </label>
                <input
                  id="admin-login-identifier"
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g., admin@fudutsinma.edu.ng or ENG/2011/0001"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Enter your institutional administrator email address or privileged staff username.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="admin-login-password"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Password
                  </label>
                  <Link
                    to="/reset-password"
                    className="text-xs font-medium text-[#0369A1] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="admin-login-password"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter administrator password"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || authMode === 'unconfigured'}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Verifying Super Admin Role...'
                    : 'Sign In to Admin Dashboard'}
                </span>
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>Standard clinical staff or student?</span>
              <Link to="/login" className="font-semibold text-[#0F4C81] hover:underline">
                Use Standard Portal Sign In
              </Link>
            </div>
          </div>

          <aside className="lg:col-span-5 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-200 p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Cross className="w-4 h-4 text-[#0F4C81]" />
                <h2 className="text-sm font-bold">Access Verification Policy</h2>
              </div>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                This endpoint enforces strict role-based separation for FUDMA HEALTHCENTER
                administrative operations.
              </p>

              <ul className="mt-5 space-y-4 text-xs">
                <li className="flex items-start gap-2.5">
                  <Database className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Database Role Verification</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      Every sign-in validates an active{' '}
                      <code className="font-mono text-[11px] text-slate-800">super_admin</code>{' '}
                      record in <code className="font-mono text-[11px] text-slate-800">user_roles</code>{' '}
                      and active status in{' '}
                      <code className="font-mono text-[11px] text-slate-800">profiles</code>.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-2.5">
                  <UserCheck className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Non-Admin Accounts Rejected</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      Patients, students, nursing, laboratory, pharmacy, doctor, and non-super
                      accounts are denied access and signed out immediately.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Independent of Student Whitelist</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      Administrator authentication never queries the Group 11 student registration
                      whitelist and preserves all Row-Level Security policies.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
              Federal University Dutsin-Ma Health Center · All privileged sign-in events are
              recorded in the institutional audit log.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
