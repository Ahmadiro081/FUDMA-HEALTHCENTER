import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Cross,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { getRoleDashboardPath, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEMO_ACCOUNTS = [
  { role: 'Patient', email: 'patient@fudma.edu.ng', pass: 'Fudma@2026' },
  { role: 'Nursing Station', email: 'nurse@fudma.edu.ng', pass: 'Fudma@2026' },
  { role: 'Consultant / Doctor', email: 'doctor@fudma.edu.ng', pass: 'Fudma@2026' },
  { role: 'Medical Laboratory', email: 'lab@fudma.edu.ng', pass: 'Fudma@2026' },
  { role: 'Hospital Pharmacy', email: 'pharmacy@fudma.edu.ng', pass: 'Fudma@2026' },
  { role: 'System Administrator', email: 'admin@fudma.edu.ng', pass: 'Fudma@2026' },
];

export function LoginPage() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showDemos, setShowDemos] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter both your email address and password.');
      return;
    }
    setSubmitting(true);
    try {
      const signedUser = await login(email.trim(), password);
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

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@fudma.edu.ng"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
              />
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
            <span className="text-slate-600">New student or staff patient?</span>
            <Link to="/register" className="font-semibold text-[#0F4C81] hover:underline">
              Create Patient Account
            </Link>
          </div>
        </div>

        {/* Academic Demo Credentials Helper */}
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
                Click any role below to fill credentials, then click Sign In.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
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
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    gender: 'Male',
    date_of_birth: '',
    patient_category: 'Student',
    matric_or_staff_id: '',
    faculty_or_unit: '',
    blood_group: 'Unknown',
    genotype: 'Unknown',
    allergies: '',
    address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.full_name.trim() || !form.email.trim() || !form.phone.trim()) {
      setError('Full name, email address, and phone number are required.');
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
    try {
      const created = await register({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender: form.gender,
        date_of_birth: form.date_of_birth || null,
        patient_category: form.patient_category,
        matric_or_staff_id: form.matric_or_staff_id,
        faculty_or_unit: form.faculty_or_unit,
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
      setError(err instanceof Error ? err.message : 'Registration failed.');
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
                  Federal University Dutsin-Ma · Patient Portal Enrollment
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-sky-900">
            <ShieldCheck className="w-4 h-4 text-[#0369A1] shrink-0 mt-0.5" />
            <span>
              Public registration automatically assigns a <strong>Patient</strong> account. Clinical staff
              accounts (Nursing, Laboratory, Pharmacy, Doctors) are provisioned exclusively by the System Administrator.
            </span>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={form.full_name}
                  onChange={(e) => handleChange('full_name', e.target.value)}
                  placeholder="e.g., Musa Ibrahim Sadiq"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                />
              </div>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Category</label>
                <select
                  value={form.patient_category}
                  onChange={(e) => handleChange('patient_category', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                >
                  <option value="Student">University Student</option>
                  <option value="Staff">FUDMA Staff</option>
                  <option value="Dependent">Staff Dependent</option>
                  <option value="Community">Host Community</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Matriculation / Staff ID</label>
                <input
                  type="text"
                  value={form.matric_or_staff_id}
                  onChange={(e) => handleChange('matric_or_staff_id', e.target.value)}
                  placeholder="e.g., CSC/2023/0142"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Faculty / Department</label>
                <input
                  type="text"
                  value={form.faculty_or_unit}
                  onChange={(e) => handleChange('faculty_or_unit', e.target.value)}
                  placeholder="e.g., Faculty of Computing"
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
  const { resetPassword, authMode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [verification, setVerification] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const msg = await resetPassword({
        email: email.trim(),
        new_password: newPassword,
        hospital_or_staff_check: verification.trim() || undefined,
      });
      showToast(msg, 'success');
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
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
          <h1 className="text-xl font-bold text-slate-900">Reset Account Password</h1>
          <p className="mt-1 text-xs text-slate-500">
            Verify your email and hospital/phone identifier to set a new password.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Registered Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@fudma.edu.ng"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>
            {authMode === 'local' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number or Matric/Hospital ID
                  </label>
                  <input
                    type="text"
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    placeholder="e.g., CSC/2022/0184 or last 4 phone digits"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">New Password *</label>
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
              </>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Updating Password...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
