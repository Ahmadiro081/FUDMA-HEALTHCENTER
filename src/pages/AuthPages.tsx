import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cross,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { getRoleDashboardPath, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

declare const __DEV_DEMO_ACCOUNTS__: boolean;

const SHOW_DEV_DEMO_ACCOUNTS =
  typeof __DEV_DEMO_ACCOUNTS__ !== 'undefined' && __DEV_DEMO_ACCOUNTS__ && import.meta.env.DEV;

const DEMO_ACCOUNTS = SHOW_DEV_DEMO_ACCOUNTS
  ? [
      { role: 'Patient', email: 'patient@fudma.edu.ng', pass: 'Fudma@2026' },
      { role: 'Nursing Station', email: 'nurse@fudma.edu.ng', pass: 'Fudma@2026' },
      { role: 'Consultant / Doctor', email: 'doctor@fudma.edu.ng', pass: 'Fudma@2026' },
      { role: 'Medical Laboratory', email: 'lab@fudma.edu.ng', pass: 'Fudma@2026' },
      { role: 'Hospital Pharmacy', email: 'pharmacy@fudma.edu.ng', pass: 'Fudma@2026' },
      { role: 'System Administrator', email: 'admin@fudma.edu.ng', pass: 'Fudma@2026' },
    ]
  : [];

export function LoginPage() {
  const { login, authMode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showDemos, setShowDemos] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Please enter your matriculation number (or email) and password.');
      return;
    }
    setSubmitting(true);
    try {
      const signedUser = await login(identifier.trim(), password);
      showToast(`Welcome back, ${signedUser.full_name}`, 'success');
      navigate(getRoleDashboardPath(signedUser.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F4C81] mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to FUDMA HEALTHCENTER Home</span>
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
              <Cross className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Portal Sign In</h1>
              <p className="text-xs text-slate-500">FUDMA HEALTHCENTER · Hospital Management</p>
            </div>
          </div>

          {authMode === 'unconfigured' && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              Production Supabase authentication is not configured. Add <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> to enable sign in.
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-identifier" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username / Matriculation Number
              </label>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g., ENG/2024/XXXXX or staff@fudma.edu.ng"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Students: enter your Matriculation Number. Clinical staff &amp; admins: enter your email.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
                <Link to="/reset-password" className="text-xs font-medium text-[#0369A1] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
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
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
            >
              <Lock className="w-4 h-4" />
              <span>{submitting ? 'Signing In...' : 'Sign In to Portal'}</span>
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-600">Approved Group 11 student?</span>
            <Link to="/register" className="font-semibold text-[#0F4C81] hover:underline">
              Create Patient Account
            </Link>
          </div>
        </div>

        {/* Academic Demo Credentials Helper (Development builds only) */}
        {SHOW_DEV_DEMO_ACCOUNTS && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDemos((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <span>Academic Demonstration Accounts (6 Portals)</span>
              {showDemos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showDemos && (
              <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Development preview only. Click any role below to fill credentials, then click Sign In.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => {
                        setIdentifier(acc.email);
                        setPassword(acc.pass);
                      }}
                      className="text-left rounded-lg border border-slate-200 px-3 py-2 hover:border-[#0369A1] hover:bg-sky-50/50 transition-colors"
                    >
                      <p className="text-xs font-semibold text-slate-900">{acc.role}</p>
                      <p className="text-[11px] font-mono text-slate-500 truncate">{acc.email}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface VerifiedGroup11Student {
  full_name: string;
  matric_number: string;
  department: string;
}

export function RegisterPage() {
  const { verifyMatric, register, authMode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [matricInput, setMatricInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifiedStudent, setVerifiedStudent] = useState<VerifiedGroup11Student | null>(null);

  const [form, setForm] = useState({
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    gender: 'Male',
    date_of_birth: '',
    blood_group: 'Unknown',
    genotype: 'Unknown',
    allergies: '',
    address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [verificationNotice, setVerificationNotice] = useState('');

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleVerifyMatric = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerificationNotice('');
    const candidate = matricInput.trim().replace(/\s+/g, '').toUpperCase();
    if (!candidate) {
      setError('Please enter your matriculation number to verify eligibility.');
      return;
    }

    setVerifying(true);
    try {
      const result = await verifyMatric(candidate);
      if (!result.ok || !result.full_name || !result.matric_number || !result.department) {
        setVerifiedStudent(null);
        setError(
          result.message ||
            'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.'
        );
        return;
      }

      setVerifiedStudent({
        full_name: result.full_name,
        matric_number: result.matric_number,
        department: result.department,
      });
      setMatricInput(result.matric_number);
      showToast('Matriculation number verified for Group 11 registration', 'success');
    } catch (err) {
      setVerifiedStudent(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to verify matriculation number against the database.'
      );
    } finally {
      setVerifying(false);
    }
  };

  const handleResetVerification = () => {
    setVerifiedStudent(null);
    setError('');
    setVerificationNotice('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!verifiedStudent) {
      setError('Please verify your Group 11 matriculation number first.');
      return;
    }
    if (!form.email.trim() || !form.phone.trim()) {
      setError('Email address and phone number are required.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setVerificationNotice('');
    try {
      const created = await register({
        full_name: verifiedStudent.full_name,
        matric_or_staff_id: verifiedStudent.matric_number,
        faculty_or_unit: verifiedStudent.department,
        patient_category: 'Student',
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender: form.gender,
        date_of_birth: form.date_of_birth || null,
        blood_group: form.blood_group,
        genotype: form.genotype,
        allergies: form.allergies,
        address: form.address,
        emergency_contact_name: form.emergency_contact_name,
        emergency_contact_phone: form.emergency_contact_phone,
      });
      showToast('Patient account created successfully', 'success');
      navigate(getRoleDashboardPath(created.role), { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      if (msg.toLowerCase().includes('verify your') || msg.toLowerCase().includes('check your email')) {
        setVerificationNotice(msg);
        showToast('Verification email sent', 'info');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F4C81] mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to FUDMA HEALTHCENTER Home</span>
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Patient Account Registration</h1>
                <p className="text-xs text-slate-500">
                  Federal University Dutsin-Ma · Group 11 Verified Student Enrollment
                </p>
              </div>
            </div>
          </div>

          {/* 2-Step Verification Indicator */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div
              className={`rounded-lg border px-3.5 py-2.5 flex items-center gap-2.5 text-xs ${
                verifiedStudent
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-[#0F4C81] bg-sky-50 text-[#0F4C81]'
              }`}
            >
              {verifiedStudent ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <span className="w-5 h-5 rounded-full bg-[#0F4C81] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  1
                </span>
              )}
              <div>
                <p className="font-semibold">Step 1: Verify Matric Number</p>
                <p className="text-[11px] opacity-80">Database whitelist check</p>
              </div>
            </div>

            <div
              className={`rounded-lg border px-3.5 py-2.5 flex items-center gap-2.5 text-xs ${
                verifiedStudent
                  ? 'border-[#0F4C81] bg-sky-50 text-[#0F4C81]'
                  : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  verifiedStudent ? 'bg-[#0F4C81] text-white' : 'bg-slate-200 text-slate-500'
                }`}
              >
                2
              </span>
              <div>
                <p className="font-semibold">Step 2: Create Account</p>
                <p className="text-[11px] opacity-80">Unlocked after verification</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-sky-900">
            <ShieldCheck className="w-4 h-4 text-[#0369A1] shrink-0 mt-0.5" />
            <span>
              Student registration is strictly limited to approved <strong>Group 11</strong> matriculation numbers
              and assigns a <strong>Patient</strong> role only. Clinical staff accounts are provisioned by the System Administrator.
            </span>
          </div>

          {authMode === 'unconfigured' && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              Production Supabase configuration is required before registering accounts.
            </div>
          )}

          {verificationNotice && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
              {verificationNotice}{' '}
              <Link to="/login" className="underline font-semibold ml-1">
                Go to Sign In
              </Link>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-start gap-2 text-xs font-medium text-red-800">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!verifiedStudent ? (
            <form onSubmit={handleVerifyMatric} className="mt-6 space-y-4">
              <div>
                <label htmlFor="verify-matric-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Matriculation Number *
                </label>
                <input
                  id="verify-matric-input"
                  type="text"
                  required
                  value={matricInput}
                  onChange={(e) => setMatricInput(e.target.value.toUpperCase())}
                  placeholder="e.g., ENG/2024/XXXXX"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase text-slate-900 placeholder:text-slate-400 placeholder:normal-case focus:border-[#0369A1] focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Enter your official FUDMA matriculation number to verify eligibility and unlock account creation.
                </p>
              </div>

              <button
                type="submit"
                disabled={verifying}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{verifying ? 'VERIFYING MATRIC NUMBER...' : 'VERIFY MATRIC NUMBER'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {/* Locked Verified Identity Panel */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Group 11 Student Identity Verified (Locked)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetVerification}
                    className="text-xs font-semibold text-[#0F4C81] hover:underline"
                  >
                    Use different matric number
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 mb-1">
                      <Lock className="w-3 h-3 text-slate-500" />
                      <span>Verified Full Name</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={verifiedStudent.full_name}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 cursor-not-allowed focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 mb-1">
                      <Lock className="w-3 h-3 text-slate-500" />
                      <span>Verified Matriculation Number</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={verifiedStudent.matric_number}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-mono font-semibold text-slate-800 cursor-not-allowed focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 mb-1">
                      <Lock className="w-3 h-3 text-slate-500" />
                      <span>Verified Department</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={verifiedStudent.department}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 cursor-not-allowed focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 mb-1">
                      <Lock className="w-3 h-3 text-slate-500" />
                      <span>Patient Category</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value="Student"
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 cursor-not-allowed focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="student@fudma.edu.ng"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={form.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="+234 803 000 0000"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => handleChange('gender', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) => handleChange('date_of_birth', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
                  <select
                    value={form.blood_group}
                    onChange={(e) => handleChange('blood_group', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    {['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Genotype</label>
                  <select
                    value={form.genotype}
                    onChange={(e) => handleChange('genotype', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    {['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC'].map((gt) => (
                      <option key={gt} value={gt}>
                        {gt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Known Allergies</label>
                  <input
                    type="text"
                    value={form.allergies}
                    onChange={(e) => handleChange('allergies', e.target.value)}
                    placeholder="e.g., Penicillin, None"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Campus / Residential Address</label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Hostel block or Dutsin-Ma address"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Name</label>
                  <input
                    type="text"
                    value={form.emergency_contact_name}
                    onChange={(e) => handleChange('emergency_contact_name', e.target.value)}
                    placeholder="Next of kin full name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Phone</label>
                  <input
                    type="tel"
                    value={form.emergency_contact_phone}
                    onChange={(e) => handleChange('emergency_contact_phone', e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={form.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={form.confirm_password}
                    onChange={(e) => handleChange('confirm_password', e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Creating Patient Account...' : 'Create Patient Account'}
              </button>
            </form>
          )}

          <div className="mt-5 pt-5 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-600">Already have an account?</span>
            <Link to="/login" className="font-semibold text-[#0F4C81] hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const { resetPassword, updateRecoveryPassword, authMode, recoveryMode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your registered email address.');
      return;
    }
    setSubmitting(true);
    try {
      const msg = await resetPassword(email.trim());
      showToast(msg, 'success');
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send password recovery link.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const msg = await updateRecoveryPassword(newPassword);
      showToast(msg, 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F4C81] mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Sign In</span>
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <h1 className="text-xl font-bold text-slate-900">Account Password Recovery</h1>

          {authMode !== 'supabase' ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-2">
                <p className="font-semibold">
                  {authMode === 'unconfigured'
                    ? 'Supabase Configuration Required'
                    : 'Self-Service Password Reset Disabled'}
                </p>
                <p>
                  {authMode === 'unconfigured'
                    ? 'Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable verified email password recovery.'
                    : 'Direct password resets are disabled in standalone mode to protect patient and clinical accounts from unauthorized changes.'}
                </p>
                <p>
                  To recover your account, please contact the FUDMA Healthcenter System Administrator
                  or ICT Clinic Desk with your valid university/hospital ID.
                </p>
              </div>
              <Link
                to="/login"
                className="w-full inline-flex items-center justify-center rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] transition-colors"
              >
                Return to Sign In
              </Link>
            </div>
          ) : recoveryMode ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Your recovery link has been verified. Set a new password for your account below.
              </p>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleSetNewPassword} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
                >
                  {submitting ? 'Updating Password...' : 'Update Password'}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Enter your registered email address to receive a verified password recovery link.
              </p>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Registered Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@fudma.edu.ng"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
                >
                  {submitting ? 'Sending Recovery Link...' : 'Send Recovery Email'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
