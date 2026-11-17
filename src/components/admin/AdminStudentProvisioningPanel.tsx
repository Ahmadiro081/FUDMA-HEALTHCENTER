import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
} from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import type { StudentAccountSummary } from '../../types/hospital';

const FUDMA_DEPARTMENTS = [
  'Civil Engineering',
  'Mechanical Engineering',
  'Mechatronics Engineering',
  'Electrical & Electronics Engineering',
  'Computer Science',
  'Information Technology',
  'Software Engineering',
  'Biochemistry & Molecular Biology',
  'Microbiology',
  'Medicine & Surgery',
  'Economics & Development Studies',
];

const BLOOD_GROUPS = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPES = ['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC'];

function generateUniqueStudentPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%';
  const all = upper + lower + digits + symbols;

  const bytes = new Uint32Array(12);
  window.crypto.getRandomValues(bytes);

  const chars = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ];
  for (let i = 4; i < 12; i += 1) {
    chars.push(all[bytes[i] % all.length]);
  }
  // Fisher-Yates shuffle using remaining randomness
  const shuffleBytes = new Uint32Array(chars.length);
  window.crypto.getRandomValues(shuffleBytes);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = shuffleBytes[i] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

interface ProvisionedCredentialHandoff {
  full_name: string;
  matric_number: string;
  hospital_number: string;
  email: string;
  password: string;
}

interface AdminStudentProvisioningPanelProps {
  students: StudentAccountSummary[];
  onCreateStudent: (payload: Record<string, unknown>) => Promise<{ student: StudentAccountSummary }>;
  onToggleStudentActive: (student: StudentAccountSummary) => Promise<void>;
}

export function AdminStudentProvisioningPanel({
  students,
  onCreateStudent,
  onToggleStudentActive,
}: AdminStudentProvisioningPanelProps) {
  const [form, setForm] = useState({
    full_name: '',
    matric_number: '',
    department: 'Computer Science',
    email: '',
    password: '',
    phone: '',
    gender: '',
    blood_group: 'Unknown',
    genotype: 'Unknown',
    allergies: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [handoff, setHandoff] = useState<ProvisionedCredentialHandoff | null>(null);
  const [revealHandoffPass, setRevealHandoffPass] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.matric_number || '').toLowerCase().includes(q) ||
        s.hospital_number.toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, statusFilter]);

  const handleGeneratePassword = () => {
    const generated = generateUniqueStudentPassword();
    setForm((p) => ({ ...p, password: generated }));
    setShowPassword(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanMatric = form.matric_number.trim().replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]+\/\d{4}\/\d+$/.test(cleanMatric)) {
      setFormError('Matriculation number must match format e.g. ENG/2024/33001.');
      return;
    }
    if (cleanMatric === 'ENG/2011/0001') {
      setFormError('ENG/2011/0001 is reserved for the Super Administrator and cannot be assigned to a student.');
      return;
    }
    if (form.password.length < 6) {
      setFormError('Assigned unique password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const assignedPassword = form.password;
      const result = await onCreateStudent({
        full_name: form.full_name.trim(),
        matric_number: cleanMatric,
        department: form.department.trim(),
        email: form.email.trim().toLowerCase(),
        password: assignedPassword,
        phone: form.phone.trim() || undefined,
        gender: form.gender || undefined,
        blood_group: form.blood_group,
        genotype: form.genotype,
        allergies: form.allergies.trim() || undefined,
      });

      setHandoff({
        full_name: result.student.full_name,
        matric_number: result.student.matric_number || cleanMatric,
        hospital_number: result.student.hospital_number,
        email: result.student.email || form.email.trim().toLowerCase(),
        password: assignedPassword,
      });
      setRevealHandoffPass(false);
      setCopiedHandoff(false);

      setForm({
        full_name: '',
        matric_number: '',
        department: form.department,
        email: '',
        password: '',
        phone: '',
        gender: '',
        blood_group: 'Unknown',
        genotype: 'Unknown',
        allergies: '',
      });
      setShowPassword(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create student account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!handoff) return;
    const summary = [
      'FUDMA HEALTHCENTER — Student Portal Credentials',
      `Student Name: ${handoff.full_name}`,
      `Matriculation No (Login ID): ${handoff.matric_number}`,
      `Email: ${handoff.email}`,
      `Hospital No: ${handoff.hospital_number}`,
      `Unique Password: ${handoff.password}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopiedHandoff(true);
    } catch {
      // Clipboard blocked in restricted iframe; keep visible reveal option
    }
  };

  const handleToggle = async (student: StudentAccountSummary) => {
    if (!student.user_id) return;
    setTogglingId(student.patient_id);
    try {
      await onToggleStudentActive(student);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Ephemeral Credential Handoff Banner after Student Creation */}
      {handoff && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-emerald-950">
                  Student Account Created &amp; Synchronized with Portal
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Share these login credentials securely with <strong>{handoff.full_name}</strong>. For security, this unique password is not displayed again once dismissed.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHandoff(null)}
              className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg border border-emerald-200 bg-white p-3.5 text-xs">
            <div>
              <span className="text-slate-500 block">Matriculation Number (Login)</span>
              <span className="font-mono font-bold text-slate-900">{handoff.matric_number}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Hospital Number</span>
              <span className="font-mono font-bold text-[#0F4C81]">{handoff.hospital_number}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Student Email</span>
              <span className="font-mono text-slate-800 break-all">{handoff.email}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Assigned Unique Password</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono font-bold text-slate-900">
                  {revealHandoffPass ? handoff.password : '••••••••••••'}
                </span>
                <button
                  type="button"
                  onClick={() => setRevealHandoffPass((v) => !v)}
                  className="text-[#0369A1] hover:underline font-semibold"
                >
                  {revealHandoffPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleCopyCredentials()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              {copiedHandoff ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedHandoff ? 'Credentials Copied' : 'Copy Student Credentials'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Direct Student Provisioning Form */}
      <form onSubmit={handleCreateSubmit} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create &amp; Synchronize New Student Account</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Directly creates the student in Supabase Auth, syncs their clinical patient record and login index, and activates immediate sign-in with the unique password you issue.
            </p>
          </div>
          <GraduationCap className="w-5 h-5 text-[#0F4C81] shrink-0" />
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label htmlFor="stu-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name *
            </label>
            <input
              id="stu-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g., Aisha Bello Musa"
              value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="stu-matric" className="block text-xs font-semibold text-slate-700 mb-1">
              Matriculation Number *
            </label>
            <input
              id="stu-matric"
              type="text"
              required
              placeholder="e.g., ENG/2024/33001"
              value={form.matric_number}
              onChange={(e) => setForm((p) => ({ ...p, matric_number: e.target.value.toUpperCase() }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:border-[#0369A1] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="stu-dept" className="block text-xs font-semibold text-slate-700 mb-1">
              Academic Department *
            </label>
            <input
              id="stu-dept"
              list="fudma-departments-list"
              required
              placeholder="Select or enter department"
              value={form.department}
              onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
            />
            <datalist id="fudma-departments-list">
              {FUDMA_DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="stu-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Student Email Address *
            </label>
            <input
              id="stu-email"
              type="email"
              required
              placeholder="student@fudma.edu.ng"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="stu-password" className="block text-xs font-semibold text-slate-700">
                Unique Student Password *
              </label>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0369A1] hover:underline"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Generate Unique</span>
              </button>
            </div>
            <div className="relative">
              <input
                id="stu-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                maxLength={128}
                placeholder="Assign unique password (min 6 chars)"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-9 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="stu-phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Phone Number
            </label>
            <input
              id="stu-phone"
              type="tel"
              placeholder="+234 800 000 0000"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="stu-gender" className="block text-xs font-semibold text-slate-700 mb-1">
              Gender
            </label>
            <select
              id="stu-gender"
              value={form.gender}
              onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
            >
              <option value="">Unspecified</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="stu-blood" className="block text-xs font-semibold text-slate-700 mb-1">
              Blood Group
            </label>
            <select
              id="stu-blood"
              value={form.blood_group}
              onChange={(e) => setForm((p) => ({ ...p, blood_group: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
            >
              {BLOOD_GROUPS.map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="stu-genotype" className="block text-xs font-semibold text-slate-700 mb-1">
              Genotype
            </label>
            <select
              id="stu-genotype"
              value={form.genotype}
              onChange={(e) => setForm((p) => ({ ...p, genotype: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
            >
              {GENOTYPES.map((gt) => (
                <option key={gt} value={gt}>
                  {gt}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="stu-allergies" className="block text-xs font-semibold text-slate-700 mb-1">
              Known Allergies (Optional)
            </label>
            <input
              id="stu-allergies"
              type="text"
              placeholder="None reported"
              value={form.allergies}
              onChange={(e) => setForm((p) => ({ ...p, allergies: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <GraduationCap className="w-4 h-4" />
            <span>{submitting ? 'Creating & Syncing...' : 'Create Student Account'}</span>
          </button>
        </div>
      </form>

      {/* Student Portal Accounts Directory */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {(['all', 'active', 'inactive'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, matric no, hospital no..."
              aria-label="Search student accounts"
              className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
            />
          </div>
        </div>

        {filteredStudents.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="w-5 h-5" />}
            title="No student portal records match"
            description="Provision a new student above to synchronize their portal login and medical record."
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Student &amp; Department</th>
                  <th className="py-3 px-4">Matric No</th>
                  <th className="py-3 px-4">Hospital No</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Portal Access</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map((stu) => (
                  <tr key={stu.patient_id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{stu.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {stu.department || 'General Studies'}
                        {stu.blood_group && stu.blood_group !== 'Unknown' ? ` · ${stu.blood_group}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {stu.matric_number || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0F4C81] tabular-nums whitespace-nowrap">
                      {stu.hospital_number}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {stu.email || 'Walk-in only'}
                    </td>
                    <td className="py-3 px-4">
                      {stu.user_id ? (
                        <StatusBadge status={stu.is_active ? 'Active' : 'Inactive'} />
                      ) : (
                        <span className="text-xs text-slate-500">Walk-in Record</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {stu.user_id ? (
                        <button
                          type="button"
                          disabled={togglingId === stu.patient_id}
                          onClick={() => void handleToggle(stu)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                          {stu.is_active ? (
                            <>
                              <UserX className="w-3.5 h-3.5 text-red-600" />
                              <span>Deactivate</span>
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Activate</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">No Login</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
