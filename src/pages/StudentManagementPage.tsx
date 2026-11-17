import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { DashboardLayout, type SidebarNavItem } from '../components/DashboardLayout';
import { BulkStudentImportPanel } from '../components/admin/BulkStudentImportPanel';
import { StudentDetailsModal } from '../components/admin/StudentDetailsModal';
import { StudentEditModal } from '../components/admin/StudentEditModal';
import { EmptyState, LoadingSkeleton } from '../components/ui/EmptyState';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type { StudentAccountSummary } from '../types/hospital';

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

export function StudentManagementPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [viewTab, setViewTab] = useState<'directory' | 'register' | 'bulk'>('directory');
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentAccountSummary[]>([]);
  const [stats, setStats] = useState({
    total_students: 0,
    active_students: 0,
    inactive_students: 0,
  });

  // Directory filters
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modals & row action state
  const [detailPatientId, setDetailPatientId] = useState<string | null>(null);
  const [editingStudent, setEditingStudent] = useState<StudentAccountSummary | null>(null);
  const [confirmToggleStudent, setConfirmToggleStudent] = useState<StudentAccountSummary | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Individual registration form state
  const [form, setForm] = useState({
    full_name: '',
    matric_number: '',
    department: 'Computer Science',
    email: '',
    password: '',
    phone: '',
    gender: '' as '' | 'Male' | 'Female' | 'Other',
    date_of_birth: '',
    address: '',
    blood_group: 'Unknown',
    genotype: 'Unknown',
    allergies: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [handoff, setHandoff] = useState<ProvisionedCredentialHandoff | null>(null);
  const [revealHandoffPass, setRevealHandoffPass] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.admin.listStudents();
      setStudents(res.students);
      setStats(res.stats);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load student directory.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>(FUDMA_DEPARTMENTS);
    students.forEach((s) => {
      if (s.department && s.department.trim()) {
        set.add(s.department.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (departmentFilter !== 'all' && (s.department || '').trim() !== departmentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.matric_number || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        s.hospital_number.toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, departmentFilter, statusFilter]);

  const portalSyncedCount = useMemo(
    () => students.filter((s) => Boolean(s.user_id || s.has_auth_account)).length,
    [students]
  );

  const executeToggleStudentStatus = async (student: StudentAccountSummary) => {
    if (!student.user_id) {
      showToast('Walk-in clinical records without a portal login cannot be activated or deactivated here.', 'error');
      return;
    }
    setTogglingId(student.patient_id);
    try {
      const nextActive = !student.is_active;
      await api.admin.updateStudentStatus(student.user_id, nextActive);
      showToast(
        nextActive
          ? `Student account reactivated for ${student.full_name}`
          : `Student account deactivated for ${student.full_name}`,
        nextActive ? 'success' : 'info',
        nextActive
          ? 'Existing portal login and records restored.'
          : 'Portal login & active sessions blocked; clinical history preserved.'
      );
      setConfirmToggleStudent(null);
      await loadStudents();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update student status.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

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
      const res = await api.admin.createStudent({
        full_name: form.full_name.trim(),
        matric_number: cleanMatric,
        department: form.department.trim(),
        email: form.email.trim().toLowerCase(),
        password: assignedPassword,
        phone: form.phone.trim() || undefined,
        gender: form.gender || undefined,
        date_of_birth: form.date_of_birth.trim() || undefined,
        address: form.address.trim() || undefined,
        blood_group: form.blood_group,
        genotype: form.genotype,
        allergies: form.allergies.trim() || undefined,
        emergency_contact_name: form.emergency_contact_name.trim() || undefined,
        emergency_contact_phone: form.emergency_contact_phone.trim() || undefined,
      });

      setHandoff({
        full_name: res.student.full_name,
        matric_number: res.student.matric_number || cleanMatric,
        hospital_number: res.student.hospital_number,
        email: res.student.email || form.email.trim().toLowerCase(),
        password: assignedPassword,
      });
      setRevealHandoffPass(false);
      setCopiedHandoff(false);

      showToast(
        `Student registered & synced for ${res.student.full_name}`,
        'success',
        `Matric: ${res.student.matric_number || cleanMatric}`
      );

      setForm({
        full_name: '',
        matric_number: '',
        department: form.department,
        email: '',
        password: '',
        phone: '',
        gender: '',
        date_of_birth: '',
        address: '',
        blood_group: 'Unknown',
        genotype: 'Unknown',
        allergies: '',
        emergency_contact_name: '',
        emergency_contact_phone: '',
      });
      setShowPassword(false);
      await loadStudents();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to register student account.');
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
      // Clipboard blocked in restricted context
    }
  };

  const navItems: SidebarNavItem[] = [
    { id: 'overview', label: 'Hospital Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'students', label: 'Student Management', icon: <GraduationCap className="w-4 h-4" /> },
    { id: 'staff', label: 'Staff & Roles', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'departments', label: 'Departments', icon: <Building2 className="w-4 h-4" /> },
    { id: 'operations', label: 'Patients & Appointments', icon: <Users className="w-4 h-4" /> },
    { id: 'logs', label: 'Activity Audit Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: 'System Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const handleSidebarChange = (id: string) => {
    if (id === 'students') return;
    if (id === 'overview') {
      navigate('/portal/admin');
      return;
    }
    navigate(`/portal/admin?tab=${encodeURIComponent(id)}`);
  };

  const breadcrumbMap: Record<typeof viewTab, string> = {
    directory: 'Student Management Directory',
    register: 'Individual Student Registration',
    bulk: 'Bulk Student Import (CSV / Excel)',
  };

  return (
    <DashboardLayout
      portalTitle="Super Administrator"
      breadcrumb={breadcrumbMap[viewTab]}
      navItems={navItems}
      activeTab="students"
      onTabChange={handleSidebarChange}
      headerAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewTab('bulk')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F4C81]" />
            <span>Bulk Import</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab('register')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register Student</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Super Admin Governance Banner */}
        <div className="rounded-lg border border-slate-300 bg-slate-900 px-4 py-3 text-xs text-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              <strong className="font-semibold text-white">Student Governance Console:</strong>{' '}
              Super Administrator exclusive control for directory inspection, profile synchronization, account activation/deactivation, individual registration, and validated bulk import.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/portal/admin')}
            className="font-semibold text-sky-300 hover:underline whitespace-nowrap"
          >
            Back to Overview
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Students"
            value={stats.total_students}
            hint="All registered student profiles"
            icon={<GraduationCap className="w-5 h-5" />}
            accent="blue"
          />
          <StatCard
            label="Active Students"
            value={stats.active_students}
            hint="Portal access enabled"
            icon={<UserCheck className="w-5 h-5" />}
            accent="emerald"
          />
          <StatCard
            label="Inactive Students"
            value={stats.inactive_students}
            hint="Blocked from portal access"
            icon={<UserX className="w-5 h-5" />}
            accent="red"
          />
          <StatCard
            label="Portal-Synced Accounts"
            value={portalSyncedCount}
            hint="Linked Auth & patient records"
            icon={<ShieldCheck className="w-5 h-5" />}
            accent="teal"
          />
        </div>

        {/* Internal Module Sub-Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setViewTab('directory')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                viewTab === 'directory'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Student Directory ({students.length})
            </button>
            <button
              type="button"
              onClick={() => setViewTab('register')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                viewTab === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Individual Registration
            </button>
            <button
              type="button"
              onClick={() => setViewTab('bulk')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                viewTab === 'bulk'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bulk Import (CSV / Excel)
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadStudents()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Directory</span>
          </button>
        </div>

        {/* Directory View */}
        {viewTab === 'directory' && (
          <div className="space-y-4">
            {/* Search & Filters */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, matriculation no, email, or hospital no..."
                  aria-label="Search students"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
                />
              </div>

              <div className="md:col-span-4">
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  aria-label="Filter by department"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0369A1] focus:outline-none"
                >
                  <option value="all">All Departments</option>
                  {departmentOptions.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3 flex items-center justify-end">
                <div className="inline-flex w-full md:w-auto items-center justify-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['all', 'active', 'inactive'] as const).map((statusOpt) => (
                    <button
                      key={statusOpt}
                      type="button"
                      onClick={() => setStatusFilter(statusOpt)}
                      className={`flex-1 md:flex-none px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                        statusFilter === statusOpt
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {statusOpt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <LoadingSkeleton />
            ) : filteredStudents.length === 0 ? (
              <EmptyState
                icon={<GraduationCap className="w-5 h-5" />}
                title="No matching student accounts"
                description="Try clearing your search or department filter, or register a new student."
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Student &amp; Department</th>
                      <th className="py-3 px-4">Matriculation No</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Hospital No</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredStudents.map((stu) => (
                      <tr key={stu.patient_id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900">{stu.full_name}</p>
                          <p className="text-xs text-slate-500">
                            {stu.department || 'Unspecified Department'}
                            {stu.blood_group && stu.blood_group !== 'Unknown'
                              ? ` · ${stu.blood_group}`
                              : ''}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                          {stu.matric_number || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">
                          {stu.email || 'Walk-in record'}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0F4C81] whitespace-nowrap">
                          {stu.hospital_number}
                        </td>
                        <td className="py-3 px-4">
                          {stu.user_id ? (
                            <StatusBadge status={stu.is_active ? 'Active' : 'Inactive'} />
                          ) : (
                            <StatusBadge status="Walk-in" />
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailPatientId(stu.patient_id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#0F4C81]" />
                              <span>View</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingStudent(stu)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Pencil className="w-3.5 h-3.5 text-slate-600" />
                              <span>Edit</span>
                            </button>
                            {stu.user_id && (
                              <button
                                type="button"
                                disabled={togglingId === stu.patient_id}
                                onClick={() => setConfirmToggleStudent(stu)}
                                className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-semibold whitespace-nowrap disabled:opacity-60 ${
                                  stu.is_active
                                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                }`}
                              >
                                {stu.is_active ? (
                                  <>
                                    <UserX className="w-3.5 h-3.5" />
                                    <span>Deactivate</span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="w-3.5 h-3.5" />
                                    <span>Activate</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Individual Registration View */}
        {viewTab === 'register' && (
          <div className="space-y-6">
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
                        Share these credentials securely with <strong>{handoff.full_name}</strong>. This
                        temporary password is not stored in plain text or displayed again once dismissed.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHandoff(null)}
                    className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    {copiedHandoff ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedHandoff ? 'Credentials Copied' : 'Copy Student Credentials'}</span>
                  </button>
                </div>
              </div>
            )}

            <form
              onSubmit={handleCreateSubmit}
              className="rounded-lg border border-slate-200 bg-white p-6 space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Individual Student Registration &amp; Portal Sync
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Creates the student across Supabase Auth, Profiles, User Roles, Clinical Patients, and Group 11 Whitelist.
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
                  <label htmlFor="reg-stu-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    id="reg-stu-name"
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
                  <label htmlFor="reg-stu-matric" className="block text-xs font-semibold text-slate-700 mb-1">
                    Matriculation Number *
                  </label>
                  <input
                    id="reg-stu-matric"
                    type="text"
                    required
                    placeholder="e.g., ENG/2024/33001"
                    value={form.matric_number}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, matric_number: e.target.value.toUpperCase() }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-stu-dept" className="block text-xs font-semibold text-slate-700 mb-1">
                    Academic Department *
                  </label>
                  <input
                    id="reg-stu-dept"
                    list="reg-fudma-departments-list"
                    required
                    placeholder="Select or enter department"
                    value={form.department}
                    onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                  <datalist id="reg-fudma-departments-list">
                    {FUDMA_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="reg-stu-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Email Address *
                  </label>
                  <input
                    id="reg-stu-email"
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
                    <label htmlFor="reg-stu-password" className="block text-xs font-semibold text-slate-700">
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
                      id="reg-stu-password"
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
                  <label htmlFor="reg-stu-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    id="reg-stu-phone"
                    type="tel"
                    placeholder="+234 800 000 0000"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-stu-gender" className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    id="reg-stu-gender"
                    value={form.gender}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        gender: e.target.value as '' | 'Male' | 'Female' | 'Other',
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    <option value="">Unspecified</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-stu-dob" className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    id="reg-stu-dob"
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) => setForm((p) => ({ ...p, date_of_birth: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-stu-address" className="block text-xs font-semibold text-slate-700 mb-1">
                    Address / Hostel
                  </label>
                  <input
                    id="reg-stu-address"
                    type="text"
                    placeholder="Hostel or residential address"
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-stu-blood" className="block text-xs font-semibold text-slate-700 mb-1">
                    Blood Group
                  </label>
                  <select
                    id="reg-stu-blood"
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
                  <label htmlFor="reg-stu-genotype" className="block text-xs font-semibold text-slate-700 mb-1">
                    Genotype
                  </label>
                  <select
                    id="reg-stu-genotype"
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

                <div>
                  <label htmlFor="reg-stu-allergies" className="block text-xs font-semibold text-slate-700 mb-1">
                    Known Allergies
                  </label>
                  <input
                    id="reg-stu-allergies"
                    type="text"
                    placeholder="None reported"
                    value={form.allergies}
                    onChange={(e) => setForm((p) => ({ ...p, allergies: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-stu-em-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Emergency Contact Name
                  </label>
                  <input
                    id="reg-stu-em-name"
                    type="text"
                    placeholder="Parent / Guardian full name"
                    value={form.emergency_contact_name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, emergency_contact_name: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-2">
                  <label htmlFor="reg-stu-em-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Emergency Contact Phone
                  </label>
                  <input
                    id="reg-stu-em-phone"
                    type="tel"
                    placeholder="+234 800 000 0000"
                    value={form.emergency_contact_phone}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, emergency_contact_phone: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>{submitting ? 'Registering & Syncing...' : 'Register Student Account'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Bulk Import View */}
        {viewTab === 'bulk' && <BulkStudentImportPanel onImportComplete={loadStudents} />}
      </div>

      {/* Student Details Modal */}
      <StudentDetailsModal
        patientId={detailPatientId}
        onClose={() => setDetailPatientId(null)}
        onEdit={(student) => setEditingStudent(student)}
        onToggleActive={async (student) => {
          await executeToggleStudentStatus(student);
        }}
        togglingId={togglingId}
      />

      {/* Student Edit Modal */}
      <StudentEditModal
        student={editingStudent}
        onClose={() => setEditingStudent(null)}
        onSaved={async (updated) => {
          showToast(`Student profile updated for ${updated.full_name}`, 'success');
          await loadStudents();
        }}
      />

      {/* Activate / Deactivate Confirmation Modal */}
      {confirmToggleStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => !togglingId && setConfirmToggleStudent(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="toggle-student-title"
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  confirmToggleStudent.is_active
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {confirmToggleStudent.is_active ? (
                  <UserX className="w-5 h-5" />
                ) : (
                  <UserCheck className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 id="toggle-student-title" className="text-sm font-bold text-slate-900">
                  {confirmToggleStudent.is_active
                    ? 'Deactivate Student Account?'
                    : 'Reactivate Student Account?'}
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {confirmToggleStudent.is_active ? (
                    <>
                      Deactivating <strong>{confirmToggleStudent.full_name}</strong> (
                      <span className="font-mono">{confirmToggleStudent.matric_number}</span>) immediately
                      blocks portal login and revokes active sessions. All appointments, vitals, lab
                      requests, and prescriptions remain safely preserved.
                    </>
                  ) : (
                    <>
                      Reactivating <strong>{confirmToggleStudent.full_name}</strong> (
                      <span className="font-mono">{confirmToggleStudent.matric_number}</span>) restores
                      portal login access on the exact existing account without creating duplicate records.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={Boolean(togglingId)}
                onClick={() => setConfirmToggleStudent(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(togglingId)}
                onClick={() => void executeToggleStudentStatus(confirmToggleStudent)}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                  confirmToggleStudent.is_active
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {togglingId
                  ? 'Updating...'
                  : confirmToggleStudent.is_active
                    ? 'Confirm Deactivate'
                    : 'Confirm Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
