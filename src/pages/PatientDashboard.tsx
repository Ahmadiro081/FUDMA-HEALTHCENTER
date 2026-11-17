import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Pill,
  UserCircle,
  XCircle,
} from 'lucide-react';
import { DashboardLayout, type SidebarNavItem } from '../components/DashboardLayout';
import { EmptyState, LoadingSkeleton } from '../components/ui/EmptyState';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type {
  AppNotification,
  Appointment,
  Consultation,
  Department,
  LaboratoryRequest,
  Prescription,
  SystemSettings,
} from '../types/hospital';

const TIME_SLOTS = [
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
];

const CONSULTATION_CATEGORIES = [
  'General Consultation',
  'Acute Fever & Malaria Review',
  'Student Wellness & Medical Screening',
  'Hypertension & Chronic Review',
  'Respiratory & ENT Review',
  'Preventive & Immunization Counseling',
];

export function PatientDashboard() {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [labRequests, setLabRequests] = useState<LaboratoryRequest[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [apptFilter, setApptFilter] = useState<'all' | 'upcoming' | 'completed' | 'cancelled'>('all');

  // Booking form state
  const [bookForm, setBookForm] = useState({
    department_id: '',
    consultation_category: CONSULTATION_CATEGORIES[0],
    appointment_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    appointment_time: '09:00',
    reason: '',
  });
  const [bookingSubmitting, setBookingSubmitting] = useState(false);

  // Profile edit state
  const [profileForm, setProfileForm] = useState({
    full_name: user?.full_name || '',
    phone: user?.phone || '',
    address: user?.address || '',
    blood_group: user?.patient?.blood_group || 'Unknown',
    genotype: user?.patient?.genotype || 'Unknown',
    allergies: user?.patient?.allergies || '',
    emergency_contact_name: user?.patient?.emergency_contact_name || '',
    emergency_contact_phone: user?.patient?.emergency_contact_phone || '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [appts, cons, labs, rxs, notifs, depts, pubSet] = await Promise.all([
        api.appointments.list(),
        api.consultations.list(),
        api.laboratory.list(),
        api.pharmacy.prescriptions(),
        api.notifications.list(),
        api.reference.departments(),
        api.reference.publicSettings(),
      ]);
      setAppointments(appts.appointments);
      setConsultations(cons.consultations);
      setLabRequests(labs.requests);
      setPrescriptions(rxs.prescriptions);
      setNotifications(notifs.notifications);
      setDepartments(depts.departments.filter((d) => d.is_active));
      setSettings(pubSet.settings);
      setBookForm((prev) => ({
        ...prev,
        department_id: prev.department_id || depts.departments[0]?.id || '',
      }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load patient records', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (user) {
      setProfileForm({
        full_name: user.full_name || '',
        phone: user.phone || '',
        address: user.address || '',
        blood_group: user.patient?.blood_group || 'Unknown',
        genotype: user.patient?.genotype || 'Unknown',
        allergies: user.patient?.allergies || '',
        emergency_contact_name: user.patient?.emergency_contact_name || '',
        emergency_contact_phone: user.patient?.emergency_contact_phone || '',
      });
    }
  }, [user]);

  const upcomingAppointments = useMemo(
    () =>
      appointments.filter((a) =>
        ['Booked', 'Approved', 'Checked In', 'Waiting', 'In Consultation', 'Rescheduled'].includes(a.status)
      ),
    [appointments]
  );

  const completedConsultations = useMemo(
    () => consultations.filter((c) => c.status === 'Completed'),
    [consultations]
  );

  const pendingLabs = useMemo(
    () => labRequests.filter((l) => l.status !== 'Completed' && l.status !== 'Reviewed'),
    [labRequests]
  );

  const filteredAppointments = useMemo(() => {
    if (apptFilter === 'upcoming') return upcomingAppointments;
    if (apptFilter === 'completed') return appointments.filter((a) => a.status === 'Completed');
    if (apptFilter === 'cancelled') return appointments.filter((a) => a.status === 'Cancelled');
    return appointments;
  }, [appointments, upcomingAppointments, apptFilter]);

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookForm.department_id || !bookForm.appointment_date || !bookForm.reason.trim()) {
      showToast('Please complete all required booking fields.', 'error');
      return;
    }
    setBookingSubmitting(true);
    try {
      await api.appointments.create(bookForm);
      showToast('Appointment booked successfully', 'success', 'Check My Appointments for status updates.');
      setBookForm((prev) => ({ ...prev, reason: '' }));
      await loadAll();
      setActiveTab('appointments');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to book appointment', 'error');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const handleCancelAppointment = async (appt: Appointment) => {
    try {
      await api.appointments.update(appt.id, { status: 'Cancelled' });
      showToast(`Appointment ${appt.appointment_code} cancelled`, 'info');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to cancel appointment', 'error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.patient?.id) return;
    setSavingProfile(true);
    try {
      await api.patients.update(user.patient.id, profileForm);
      await refreshUser();
      showToast('Personal & medical profile updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Profile update failed', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const navItems: SidebarNavItem[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'book', label: 'Book Appointment', icon: <CalendarPlus className="w-4 h-4" /> },
    {
      id: 'appointments',
      label: 'My Appointments',
      icon: <Calendar className="w-4 h-4" />,
      badgeCount: upcomingAppointments.length,
    },
    {
      id: 'records',
      label: 'Consultations & Labs',
      icon: <FlaskConical className="w-4 h-4" />,
      badgeCount: pendingLabs.length,
    },
    {
      id: 'prescriptions',
      label: 'Prescriptions',
      icon: <Pill className="w-4 h-4" />,
      badgeCount: prescriptions.filter((p) => p.status !== 'Dispensed').length,
    },
    { id: 'profile', label: 'My Profile', icon: <UserCircle className="w-4 h-4" /> },
  ];

  const breadcrumbMap: Record<string, string> = {
    overview: 'Patient Overview',
    book: 'Book Appointment',
    appointments: 'My Appointments',
    records: 'Consultations & Lab Results',
    prescriptions: 'Prescriptions & Medications',
    profile: 'Patient Profile',
  };

  return (
    <DashboardLayout
      portalTitle="Patient Portal"
      breadcrumb={breadcrumbMap[activeTab] || 'Patient Portal'}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerAction={
        <button
          type="button"
          onClick={() => setActiveTab('book')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] transition-colors whitespace-nowrap"
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          <span>Book Appointment</span>
        </button>
      }
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          {/* Patient Identity Summary */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-slate-900">{user?.full_name}</h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Hospital No: <span className="font-mono font-semibold text-slate-900">{user?.patient?.hospital_number}</span>
                {' · '}
                {user?.patient?.patient_category || 'Student'}
                {user?.patient?.matric_or_staff_id ? ` · ${user.patient.matric_or_staff_id}` : ''}
                {' · '}
                Blood Group: {user?.patient?.blood_group || 'Unknown'} / Genotype: {user?.patient?.genotype || 'Unknown'}
              </p>
            </div>
            <div className="text-xs text-slate-500">
              Allergies: <span className="font-medium text-slate-800">{user?.patient?.allergies || 'None reported'}</span>
            </div>
          </div>

          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Total Appointments"
                  value={appointments.length}
                  hint="All scheduled & past visits"
                  icon={<Calendar className="w-5 h-5" />}
                  accent="blue"
                />
                <StatCard
                  label="Upcoming Appointments"
                  value={upcomingAppointments.length}
                  hint="Active bookings & queue"
                  icon={<CalendarPlus className="w-5 h-5" />}
                  accent="teal"
                />
                <StatCard
                  label="Completed Consultations"
                  value={completedConsultations.length}
                  hint="Physician-signed visits"
                  icon={<CheckCircle2 className="w-5 h-5" />}
                  accent="emerald"
                />
                <StatCard
                  label="Pending Lab Results"
                  value={pendingLabs.length}
                  hint="In progress at diagnostics"
                  icon={<FlaskConical className="w-5 h-5" />}
                  accent="amber"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">Upcoming &amp; Recent Appointments</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('appointments')}
                      className="text-xs font-semibold text-[#0369A1] hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  {appointments.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={<Calendar className="w-5 h-5" />}
                        title="No appointments scheduled"
                        description="Book your first outpatient consultation at FUDMA Healthcenter."
                        action={
                          <button
                            type="button"
                            onClick={() => setActiveTab('book')}
                            className="rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white"
                          >
                            Book Appointment
                          </button>
                        }
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {appointments.slice(0, 5).map((appt) => (
                        <div key={appt.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono font-semibold text-slate-900">{appt.appointment_code}</span>
                              <span>·</span>
                              <span className="font-mono tabular-nums">{appt.appointment_date} at {appt.appointment_time}</span>
                            </div>
                            <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                              {appt.consultation_category}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {appt.department_name} {appt.doctor_name ? `· ${appt.doctor_name}` : ''}
                            </p>
                          </div>
                          <StatusBadge status={appt.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">Recent Notifications</h2>
                    <Bell className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="p-5 text-xs text-slate-500">No recent notifications.</p>
                    ) : (
                      notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className="px-5 py-3.5">
                          <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                          <p className="text-[11px] font-mono text-slate-400 mt-1">
                            {new Date(n.created_at).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'book' && (
            <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-base font-bold text-slate-900">Book Hospital Appointment</h2>
              <p className="mt-1 text-xs text-slate-500">
                Select your clinical department, preferred date, and available consultation slot.
              </p>

              <form onSubmit={handleBookAppointment} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Clinical Department *
                    </label>
                    <select
                      required
                      value={bookForm.department_id}
                      onChange={(e) => setBookForm((p) => ({ ...p, department_id: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Consultation Category *
                    </label>
                    <select
                      required
                      value={bookForm.consultation_category}
                      onChange={(e) => setBookForm((p) => ({ ...p, consultation_category: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                    >
                      {CONSULTATION_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Appointment Date *
                    </label>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().slice(0, 10)}
                      value={bookForm.appointment_date}
                      onChange={(e) => setBookForm((p) => ({ ...p, appointment_date: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Available Time Slot *
                    </label>
                    <select
                      required
                      value={bookForm.appointment_time}
                      onChange={(e) => setBookForm((p) => ({ ...p, appointment_time: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white font-mono focus:border-[#0369A1] focus:outline-none"
                    >
                      {TIME_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Symptoms / Reason for Visit *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={bookForm.reason}
                    onChange={(e) => setBookForm((p) => ({ ...p, reason: e.target.value }))}
                    placeholder="Briefly describe your symptoms, duration, or purpose of medical review..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('appointments')}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bookingSubmitting}
                    className="rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                  >
                    {bookingSubmitting ? 'Confirming Booking...' : 'Confirm Appointment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'appointments' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                  {(['all', 'upcoming', 'completed', 'cancelled'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setApptFilter(tab)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                        apptFilter === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {filteredAppointments.length === 0 ? (
                <EmptyState
                  icon={<Calendar className="w-5 h-5" />}
                  title="No appointments match this filter"
                  description="Try switching filter tabs or schedule a new hospital appointment."
                />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Code</th>
                        <th className="py-3 px-4">Category &amp; Department</th>
                        <th className="py-3 px-4">Date &amp; Time</th>
                        <th className="py-3 px-4">Consultant</th>
                        <th className="py-3 px-4">Queue</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredAppointments.map((appt) => {
                        const canCancel =
                          settings?.allow_patient_cancellations !== false &&
                          ['Booked', 'Approved', 'Rescheduled'].includes(appt.status);
                        return (
                          <tr key={appt.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                              {appt.appointment_code}
                            </td>
                            <td className="py-3 px-4">
                              <p className="text-sm font-medium text-slate-900">{appt.consultation_category}</p>
                              <p className="text-xs text-slate-500">{appt.department_name}</p>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                              {appt.appointment_date} · {appt.appointment_time}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700">
                              {appt.doctor_name || 'Assigned at Triage'}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                              {appt.queue_number ? `#${appt.queue_number}` : '—'}
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={appt.status} />
                            </td>
                            <td className="py-3 px-4 text-right">
                              {canCancel ? (
                                <button
                                  type="button"
                                  onClick={() => handleCancelAppointment(appt)}
                                  className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Cancel</span>
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'records' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-slate-900 mb-3">Consultation History</h2>
                {consultations.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardList className="w-5 h-5" />}
                    title="No consultations recorded yet"
                    description="After a doctor completes your clinical consultation, diagnosis and treatment summaries will appear here."
                  />
                ) : (
                  <div className="space-y-3">
                    {consultations.map((con) => (
                      <div key={con.id} className="rounded-lg border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                          <div className="text-xs text-slate-500">
                            <span className="font-mono font-semibold text-slate-900">{con.appointment_code}</span>
                            {' · '}
                            <span>{con.doctor_name}</span>
                            {' · '}
                            <span className="font-mono">{new Date(con.created_at).toLocaleDateString()}</span>
                          </div>
                          <StatusBadge status={con.status} />
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs font-semibold text-slate-500">Diagnosis</p>
                            <p className="mt-0.5 font-semibold text-slate-900">{con.diagnosis}</p>
                            <p className="text-xs font-semibold text-slate-500 mt-3">Chief Complaint</p>
                            <p className="mt-0.5 text-slate-700">{con.chief_complaint}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-500">Treatment Plan</p>
                            <p className="mt-0.5 text-slate-700">{con.treatment_plan || 'Pending final plan'}</p>
                            {con.follow_up_date && (
                              <p className="mt-3 text-xs text-[#0F4C81] font-semibold">
                                Follow-up Recommended: <span className="font-mono">{con.follow_up_date}</span>
                                {con.follow_up_notes ? ` — ${con.follow_up_notes}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-3">Laboratory Requests &amp; Results</h2>
                {labRequests.length === 0 ? (
                  <EmptyState
                    icon={<FlaskConical className="w-5 h-5" />}
                    title="No laboratory investigations"
                    description="Laboratory test orders and diagnostic results requested by your doctor will appear here."
                  />
                ) : (
                  <div className="space-y-3">
                    {labRequests.map((lab) => (
                      <div key={lab.id} className="rounded-lg border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs text-slate-500 font-mono">
                              {lab.request_code} · {lab.test_category} · Ordered by {lab.doctor_name}
                            </p>
                            <h3 className="text-sm font-bold text-slate-900 mt-0.5">{lab.test_name}</h3>
                          </div>
                          <StatusBadge status={lab.status} />
                        </div>
                        {lab.result ? (
                          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <span className="font-semibold text-slate-500 block">Findings</span>
                              <span className="text-slate-900 font-medium">{lab.result.findings}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-500 block">Value / Reference Range</span>
                              <span className="font-mono text-slate-800">
                                {lab.result.numeric_value || '—'} ({lab.result.reference_range || 'N/A'})
                              </span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-500 block mb-1">Interpretation</span>
                              <StatusBadge status={lab.result.interpretation} />
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            Test is currently {lab.status.toLowerCase()}. Results will appear once verified.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'prescriptions' && (
            <div>
              <h2 className="text-base font-bold text-slate-900 mb-3">My Prescriptions</h2>
              {prescriptions.length === 0 ? (
                <EmptyState
                  icon={<Pill className="w-5 h-5" />}
                  title="No prescriptions issued"
                  description="Prescribed medications and pharmacy fulfillment updates will appear here."
                />
              ) : (
                <div className="space-y-4">
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="rounded-lg border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                        <div>
                          <span className="font-mono text-xs font-bold text-slate-900">{rx.prescription_code}</span>
                          <span className="text-xs text-slate-500 ml-2">
                            Prescribed by {rx.doctor_name} · {new Date(rx.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <StatusBadge status={rx.status} />
                      </div>
                      <div className="mt-3 divide-y divide-slate-100">
                        {rx.items.map((it) => (
                          <div key={it.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">{it.medication_name}</p>
                              <p className="text-slate-600 mt-0.5">
                                {it.dosage} · {it.frequency} · {it.duration}
                                {it.instructions ? ` (${it.instructions})` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="font-mono text-slate-600 tabular-nums">
                                Dispensed: {it.quantity_dispensed}/{it.quantity_prescribed}
                              </span>
                              <StatusBadge status={it.availability_status} />
                            </div>
                          </div>
                        ))}
                      </div>
                      {rx.pharmacist_notes && (
                        <p className="mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-600">
                          Pharmacist Counseling: {rx.pharmacist_notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-base font-bold text-slate-900">Personal &amp; Medical Information</h2>
              <p className="text-xs text-slate-500 mt-1">
                Keep your emergency contact, allergies, and contact phone current for nursing triage.
              </p>

              <form onSubmit={handleSaveProfile} className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={profileForm.full_name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
                  <select
                    value={profileForm.blood_group}
                    onChange={(e) => setProfileForm((p) => ({ ...p, blood_group: e.target.value }))}
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
                    value={profileForm.genotype}
                    onChange={(e) => setProfileForm((p) => ({ ...p, genotype: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    {['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC'].map((gt) => (
                      <option key={gt} value={gt}>
                        {gt}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Known Allergies</label>
                  <input
                    type="text"
                    value={profileForm.allergies}
                    onChange={(e) => setProfileForm((p) => ({ ...p, allergies: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Campus / Residential Address</label>
                  <input
                    type="text"
                    value={profileForm.address}
                    onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Name</label>
                  <input
                    type="text"
                    value={profileForm.emergency_contact_name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, emergency_contact_name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Phone</label>
                  <input
                    type="tel"
                    value={profileForm.emergency_contact_phone}
                    onChange={(e) => setProfileForm((p) => ({ ...p, emergency_contact_phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2 pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                  >
                    {savingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
