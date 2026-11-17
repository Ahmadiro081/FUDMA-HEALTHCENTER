import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Building2,
  Calendar,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DashboardLayout, type SidebarNavItem } from '../components/DashboardLayout';
import { LoadingSkeleton } from '../components/ui/EmptyState';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type {
  ActivityLog,
  Appointment,
  Department,
  PatientRecord,
  StaffAccountSummary,
  SystemSettings,
  UserRole,
} from '../types/hospital';

export function AdminDashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isSuperAdmin = user?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState('overview');
  const [logFilter, setLogFilter] = useState<'all' | 'super_admin'>('all');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total_patients: 0,
    total_staff: 0,
    total_appointments: 0,
    todays_appointments: 0,
    pending_labs: 0,
    pending_prescriptions: 0,
    low_stock_medications: 0,
  });
  const [staff, setStaff] = useState<StaffAccountSummary[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Create Staff Form
  const [staffForm, setStaffForm] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    role: 'nurse' as UserRole,
    department_id: '',
    specialization: '',
    consultation_room: '',
  });
  const [creatingStaff, setCreatingStaff] = useState(false);

  // Create Department Form
  const [deptForm, setDeptForm] = useState({
    name: '',
    code: '',
    location: '',
    description: '',
  });
  const [creatingDept, setCreatingDept] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, patRes, apptRes] = await Promise.all([
        api.admin.overview(),
        api.patients.list(),
        api.appointments.list(),
      ]);
      setStats(ovRes.stats);
      setStaff(ovRes.staff);
      setDepartments(ovRes.departments);
      setActivityLogs(ovRes.activity_logs);
      setSettings(ovRes.settings);
      setPatients(patRes.patients);
      setAppointments(apptRes.appointments);
      setStaffForm((prev) => ({
        ...prev,
        department_id: prev.department_id || ovRes.departments[0]?.id || '',
      }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load admin overview', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const apptStatusChart = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of appointments) {
      counts[a.status] = (counts[a.status] || 0) + 1;
    }
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [appointments]);

  const visibleLogs = useMemo(() => {
    if (logFilter === 'super_admin') {
      return activityLogs.filter(
        (log) => log.actor_role === 'super_admin' || log.action.startsWith('SUPER_ADMIN')
      );
    }
    return activityLogs;
  }, [activityLogs, logFilter]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingStaff(true);
    try {
      await api.admin.createStaff(staffForm);
      showToast(`Staff account provisioned for ${staffForm.full_name}`, 'success');
      setStaffForm((prev) => ({
        ...prev,
        full_name: '',
        email: '',
        password: '',
        phone: '',
        specialization: '',
        consultation_room: '',
      }));
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to create staff account', 'error');
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleToggleStaffActive = async (member: StaffAccountSummary) => {
    try {
      await api.admin.updateStaff(member.id, { is_active: !member.is_active });
      showToast(`${member.full_name} ${member.is_active ? 'deactivated' : 'activated'}`, 'info');
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleChangeStaffRole = async (member: StaffAccountSummary, role: UserRole) => {
    try {
      await api.admin.updateStaff(member.id, { role });
      showToast(`Role updated for ${member.full_name}`, 'success');
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Role update failed', 'error');
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingDept(true);
    try {
      await api.admin.createDepartment(deptForm);
      showToast(`Department ${deptForm.name} created`, 'success');
      setDeptForm({ name: '', code: '', location: '', description: '' });
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to create department', 'error');
    } finally {
      setCreatingDept(false);
    }
  };

  const handleToggleDepartment = async (dept: Department) => {
    try {
      await api.admin.updateDepartment(dept.id, { is_active: !dept.is_active });
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    try {
      await api.admin.updateSettings(settings);
      showToast('System configuration saved', 'success');
      await loadAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const navItems: SidebarNavItem[] = [
    { id: 'overview', label: 'Hospital Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'staff', label: 'Staff & Roles', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'departments', label: 'Departments', icon: <Building2 className="w-4 h-4" /> },
    { id: 'operations', label: 'Patients & Appointments', icon: <Users className="w-4 h-4" /> },
    { id: 'logs', label: 'Activity Audit Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: 'System Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const breadcrumbMap: Record<string, string> = {
    overview: 'Administrator Overview',
    staff: 'Staff Accounts & Role Management',
    departments: 'Clinical Departments',
    operations: 'Patients & Appointments Monitor',
    logs: 'Hospital Activity Audit Logs',
    settings: 'System Policy & Settings',
  };

  return (
    <DashboardLayout
      portalTitle={isSuperAdmin ? 'Super Administrator' : 'System Administrator'}
      breadcrumb={breadcrumbMap[activeTab] || (isSuperAdmin ? 'Super Administrator' : 'Administrator')}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerAction={
        <button
          type="button"
          onClick={() => setActiveTab('staff')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Provision Staff</span>
        </button>
      }
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          {isSuperAdmin && (
            <div className="rounded-lg border border-slate-300 bg-slate-900 px-4 py-3 text-xs text-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
                <span>
                  <strong className="font-semibold text-white">Privileged Super Admin Governance:</strong>{' '}
                  Full hospital control active. Exclusive authority to provision or govern Administrator accounts; all activity is audited.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLogFilter('super_admin');
                  setActiveTab('logs');
                }}
                className="font-semibold text-sky-300 hover:underline whitespace-nowrap"
              >
                View Super Admin Audit
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Registered Patients"
              value={stats.total_patients}
              icon={<Users className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Hospital Staff Accounts"
              value={stats.total_staff}
              icon={<ShieldCheck className="w-5 h-5" />}
              accent="teal"
            />
            <StatCard
              label="Total Appointments"
              value={stats.total_appointments}
              hint={`${stats.todays_appointments} scheduled today`}
              icon={<Calendar className="w-5 h-5" />}
              accent="emerald"
            />
            <StatCard
              label="Pending Labs / Rx"
              value={`${stats.pending_labs} / ${stats.pending_prescriptions}`}
              hint={`${stats.low_stock_medications} low-stock drugs`}
              icon={<Activity className="w-5 h-5" />}
              accent="amber"
            />
          </div>

          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-900">Appointments by Workflow Status</h2>
                <p className="text-xs text-slate-500 mt-0.5">Live distribution across hospital queues</p>
                <div className="h-72 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={apptStatusChart} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0F4C81" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h2 className="text-sm font-bold text-slate-900">Recent Audit Events</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('logs')}
                    className="text-xs font-semibold text-[#0369A1] hover:underline"
                  >
                    Full log
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {activityLogs.slice(0, 6).map((log) => (
                    <div key={log.id} className="pb-2.5 border-b border-slate-100 last:border-0 text-xs">
                      <p className="font-semibold text-slate-900">{log.action}</p>
                      <p className="text-slate-600 mt-0.5">{log.details}</p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {log.actor_name} ({log.actor_role}) · {new Date(log.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="space-y-6">
              <form onSubmit={handleCreateStaff} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Create Staff Account &amp; Assign Role</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isSuperAdmin
                      ? 'Privileged roles (Nurse, Lab Scientist, Pharmacist, Doctor, Admin) are strictly provisioned here.'
                      : 'Clinical roles (Nurse, Lab Scientist, Pharmacist, Doctor) are provisioned here. Administrator provisioning requires Super Admin.'}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <input
                    type="text"
                    required
                    placeholder="Full Name *"
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm((p) => ({ ...p, full_name: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Official Email *"
                    value={staffForm.email}
                    onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Temporary Password *"
                    value={staffForm.password}
                    onChange={(e) => setStaffForm((p) => ({ ...p, password: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={staffForm.phone}
                    onChange={(e) => setStaffForm((p) => ({ ...p, phone: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={staffForm.role}
                    onChange={(e) => setStaffForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="nurse">Nursing Station</option>
                    <option value="doctor">Consultant / Doctor</option>
                    <option value="lab">Medical Laboratory</option>
                    <option value="pharmacy">Hospital Pharmacy</option>
                    {isSuperAdmin && <option value="admin">System Administrator</option>}
                  </select>
                  {staffForm.role === 'doctor' && (
                    <>
                      <select
                        value={staffForm.department_id}
                        onChange={(e) => setStaffForm((p) => ({ ...p, department_id: e.target.value }))}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Specialization (e.g., Family Medicine)"
                        value={staffForm.specialization}
                        onChange={(e) => setStaffForm((p) => ({ ...p, specialization: e.target.value }))}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Consultation Room (e.g., Room 3)"
                        value={staffForm.consultation_room}
                        onChange={(e) => setStaffForm((p) => ({ ...p, consultation_room: e.target.value }))}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={creatingStaff}
                    className="rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                  >
                    {creatingStaff ? 'Provisioning...' : 'Create Staff Account'}
                  </button>
                </div>
              </form>

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Staff Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Assigned Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {staff.map((member) => {
                      const isRowSuperAdmin = member.role === 'super_admin';
                      const isAdminLocked = member.role === 'admin' && !isSuperAdmin;
                      return (
                        <tr key={member.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{member.full_name}</p>
                            {member.specialization && (
                              <p className="text-xs text-slate-500">
                                {member.specialization} · {member.consultation_room}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600">{member.email}</td>
                          <td className="py-3 px-4">
                            {isRowSuperAdmin ? (
                              <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                                Super Admin · Protected
                              </span>
                            ) : isAdminLocked ? (
                              <span className="inline-flex items-center rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                Admin · Locked
                              </span>
                            ) : (
                              <select
                                value={member.role}
                                onChange={(e) => handleChangeStaffRole(member, e.target.value as UserRole)}
                                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium"
                              >
                                <option value="nurse">Nurse</option>
                                <option value="doctor">Doctor</option>
                                <option value="lab">Lab Scientist</option>
                                <option value="pharmacy">Pharmacist</option>
                                {isSuperAdmin && <option value="admin">Admin</option>}
                              </select>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={member.is_active ? 'Active' : 'Inactive'} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            {isRowSuperAdmin ? (
                              <span className="text-xs font-medium text-slate-400">Immutable</span>
                            ) : isAdminLocked ? (
                              <span className="text-xs font-medium text-slate-400">Super Admin Only</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleToggleStaffActive(member)}
                                className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                {member.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'departments' && (
            <div className="space-y-6">
              <form onSubmit={handleCreateDepartment} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900">Add Clinical Department</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <input
                    type="text"
                    required
                    placeholder="Department Name *"
                    value={deptForm.name}
                    onChange={(e) => setDeptForm((p) => ({ ...p, name: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Code (e.g., DENT) *"
                    value={deptForm.code}
                    onChange={(e) => setDeptForm((p) => ({ ...p, code: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                  />
                  <input
                    type="text"
                    placeholder="Building / Wing Location"
                    value={deptForm.location}
                    onChange={(e) => setDeptForm((p) => ({ ...p, location: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Department Description"
                    value={deptForm.description}
                    onChange={(e) => setDeptForm((p) => ({ ...p, description: e.target.value }))}
                    className="sm:col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={creatingDept}
                    className="rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white"
                  >
                    {creatingDept ? 'Adding...' : 'Add Department'}
                  </button>
                </div>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {departments.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-mono font-semibold text-[#0F4C81]">
                        {d.code} · {d.location || 'Main Complex'}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900 mt-1">{d.name}</h3>
                      <p className="text-xs text-slate-600 mt-1">{d.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <StatusBadge status={d.is_active ? 'Active' : 'Inactive'} />
                      <button
                        type="button"
                        onClick={() => handleToggleDepartment(d)}
                        className="text-xs font-semibold text-[#0369A1] hover:underline"
                      >
                        {d.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'operations' && (
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Hospital Appointments Monitor</h2>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Patient</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Doctor</th>
                      <th className="py-3 px-4">Schedule</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {appointments.map((a) => (
                      <tr key={a.id}>
                        <td className="py-3 px-4 font-mono text-xs font-semibold">{a.appointment_code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{a.patient_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">{a.department_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-700">{a.doctor_name || 'Unassigned'}</td>
                        <td className="py-3 px-4 font-mono text-xs">{a.appointment_date} {a.appointment_time}</td>
                        <td className="py-3 px-4"><StatusBadge status={a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Patient Directory ({patients.length})</h2>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Hospital No</th>
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4">Blood / Genotype</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {patients.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0F4C81]">{p.hospital_number}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{p.full_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">{p.patient_category}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">{p.phone || '—'}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">{p.blood_group} / {p.genotype}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-slate-900">System Activity &amp; Audit Logs</h2>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setLogFilter('all')}
                    className={`rounded-md px-3 py-1 font-semibold transition-colors ${
                      logFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Audit Logs ({activityLogs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogFilter('super_admin')}
                    className={`rounded-md px-3 py-1 font-semibold transition-colors ${
                      logFilter === 'super_admin'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Super Admin Audit
                  </button>
                </div>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Entity</th>
                    <th className="py-3 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {visibleLogs.map((log) => {
                    const isSuperEvent = log.actor_role === 'super_admin' || log.action.startsWith('SUPER_ADMIN');
                    return (
                      <tr key={log.id} className={isSuperEvent ? 'bg-slate-50/90 hover:bg-slate-100/70' : 'hover:bg-slate-50/70'}>
                        <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {log.actor_name}{' '}
                          <span
                            className={
                              log.actor_role === 'super_admin'
                                ? 'inline-block rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white'
                                : 'text-slate-400'
                            }
                          >
                            ({log.actor_role})
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-[#0F4C81]">{log.action}</td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {log.entity_type} {log.entity_id ? `· ${log.entity_id}` : ''}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{log.details}</td>
                      </tr>
                    );
                  })}
                  {visibleLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                        No audit events recorded for this filter yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'settings' && settings && (
            <form onSubmit={handleSaveSettings} className="max-w-xl rounded-lg border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Hospital Scheduling &amp; Policy Settings</h2>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Clinic Operating Hours</label>
                <input
                  type="text"
                  value={settings.clinic_hours}
                  onChange={(e) => setSettings((s) => (s ? { ...s, clinic_hours: e.target.value } : s))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Max Daily Appointments</label>
                  <input
                    type="number"
                    min={10}
                    value={settings.max_daily_appointments}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, max_daily_appointments: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Slot Interval (Minutes)</label>
                  <input
                    type="number"
                    min={10}
                    value={settings.appointment_slot_minutes}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, appointment_slot_minutes: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={settings.allow_patient_cancellations}
                  onChange={(e) =>
                    setSettings((s) => (s ? { ...s, allow_patient_cancellations: e.target.checked } : s))
                  }
                  className="rounded border-slate-300"
                />
                <span>Allow patients to cancel un-checked-in appointments</span>
              </label>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1]"
                >
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
