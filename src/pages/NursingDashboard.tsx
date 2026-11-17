import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarCheck,
  ClipboardCheck,
  HeartPulse,
  Search,
  Stethoscope,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { DashboardLayout, type SidebarNavItem } from '../components/DashboardLayout';
import { EmptyState, LoadingSkeleton } from '../components/ui/EmptyState';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type {
  Appointment,
  Department,
  DoctorRecord,
  PatientRecord,
  PatientVital,
  PriorityLevel,
} from '../types/hospital';

export function NursingDashboard() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('queue');
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vitals, setVitals] = useState<PatientVital[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected appointment for Triage & Vitals Recording
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [vitalsForm, setVitalsForm] = useState({
    temperature_c: '36.8',
    blood_pressure: '120/80',
    pulse_bpm: '78',
    respiratory_rate: '18',
    spo2_percent: '98',
    weight_kg: '68',
    height_cm: '170',
    priority: 'Normal' as PriorityLevel,
    doctor_id: '',
    triage_notes: '',
  });
  const [savingVitals, setSavingVitals] = useState(false);

  // Walk-In Patient Registration Form
  const [walkInForm, setWalkInForm] = useState({
    full_name: '',
    phone: '',
    gender: 'Male',
    patient_category: 'Student',
    matric_or_staff_id: '',
    blood_group: 'Unknown',
    allergies: '',
    department_id: '',
    consultation_category: 'General Consultation',
    reason: '',
    book_immediately: true,
  });
  const [savingWalkIn, setSavingWalkIn] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [patRes, apptRes, docRes, deptRes, vitRes] = await Promise.all([
        api.patients.list(),
        api.appointments.list(),
        api.reference.doctors(),
        api.reference.departments(),
        api.vitals.list(),
      ]);
      setPatients(patRes.patients);
      setAppointments(apptRes.appointments);
      setDoctors(docRes.doctors);
      setDepartments(deptRes.departments.filter((d) => d.is_active));
      setVitals(vitRes.vitals);
      setWalkInForm((prev) => ({
        ...prev,
        department_id: prev.department_id || deptRes.departments[0]?.id || '',
      }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load nursing station data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = useMemo(
    () => appointments.filter((a) => a.appointment_date === today),
    [appointments, today]
  );
  const waitingCount = useMemo(
    () => appointments.filter((a) => a.status === 'Waiting').length,
    [appointments]
  );
  const checkedInCount = useMemo(
    () => appointments.filter((a) => a.status === 'Checked In').length,
    [appointments]
  );
  const inConsultCount = useMemo(
    () => appointments.filter((a) => a.status === 'In Consultation').length,
    [appointments]
  );

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.hospital_number.toLowerCase().includes(q) ||
        (p.matric_or_staff_id || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q)
    );
  }, [patients, searchQuery]);

  const handleQuickCheckIn = async (appt: Appointment) => {
    try {
      await api.appointments.update(appt.id, { status: 'Checked In' });
      showToast(`${appt.patient_name} checked in`, 'success', 'Now record vital signs and assign a doctor.');
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed', 'error');
    }
  };

  const openTriageDrawer = (appt: Appointment) => {
    setSelectedAppt(appt);
    setVitalsForm((prev) => ({
      ...prev,
      doctor_id: appt.doctor_id || doctors[0]?.id || '',
      triage_notes: '',
    }));
  };

  const handleSaveVitalsAndQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppt) return;
    setSavingVitals(true);
    try {
      await api.vitals.create({
        appointment_id: selectedAppt.id,
        ...vitalsForm,
      });
      showToast(
        'Vitals recorded & patient added to Waiting Queue',
        'success',
        `${selectedAppt.patient_name} routed to assigned doctor.`
      );
      setSelectedAppt(null);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save vital signs', 'error');
    } finally {
      setSavingVitals(false);
    }
  };

  const handleAllocateDoctor = async (apptId: string, doctorId: string) => {
    try {
      await api.appointments.update(apptId, { doctor_id: doctorId || null });
      showToast('Consultant allocation updated', 'success');
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Allocation failed', 'error');
    }
  };

  const handleRegisterWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInForm.full_name.trim() || !walkInForm.phone.trim()) {
      showToast('Patient name and phone number are required.', 'error');
      return;
    }
    setSavingWalkIn(true);
    try {
      const res = await api.patients.createWalkIn({
        full_name: walkInForm.full_name,
        phone: walkInForm.phone,
        gender: walkInForm.gender,
        patient_category: walkInForm.patient_category,
        matric_or_staff_id: walkInForm.matric_or_staff_id,
        blood_group: walkInForm.blood_group,
        allergies: walkInForm.allergies,
      });

      if (walkInForm.book_immediately && walkInForm.reason.trim()) {
        await api.appointments.create({
          patient_id: res.patient.id,
          department_id: walkInForm.department_id,
          consultation_category: walkInForm.consultation_category,
          appointment_date: today,
          appointment_time: new Date().toTimeString().slice(0, 5),
          reason: walkInForm.reason,
          auto_check_in: true,
        });
      }

      showToast(`Walk-in patient ${res.patient.full_name} registered (${res.patient.hospital_number})`, 'success');
      setWalkInForm((prev) => ({
        ...prev,
        full_name: '',
        phone: '',
        matric_or_staff_id: '',
        allergies: '',
        reason: '',
      }));
      await loadData();
      setActiveTab('queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Walk-in registration failed', 'error');
    } finally {
      setSavingWalkIn(false);
    }
  };

  const navItems: SidebarNavItem[] = [
    {
      id: 'queue',
      label: 'Triage & Waiting Queue',
      icon: <HeartPulse className="w-4 h-4" />,
      badgeCount: waitingCount + checkedInCount,
    },
    {
      id: 'appointments',
      label: 'All Appointments',
      icon: <CalendarCheck className="w-4 h-4" />,
      badgeCount: appointments.filter((a) => a.status === 'Booked').length,
    },
    { id: 'patients', label: 'Registered Patients', icon: <Users className="w-4 h-4" /> },
    { id: 'walkin', label: 'Walk-In Registration', icon: <UserPlus className="w-4 h-4" /> },
  ];

  const breadcrumbMap: Record<string, string> = {
    queue: 'Triage & Waiting Queue',
    appointments: 'Appointments & Check-In',
    patients: 'Registered Patients Directory',
    walkin: 'Walk-In Patient Registration',
  };

  return (
    <DashboardLayout
      portalTitle="Nursing Station"
      breadcrumb={breadcrumbMap[activeTab] || 'Nursing Station'}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerAction={
        <button
          type="button"
          onClick={() => setActiveTab('walkin')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Register Walk-In</span>
        </button>
      }
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              label="Registered Patients"
              value={patients.length}
              icon={<Users className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Today's Appointments"
              value={todaysAppointments.length}
              icon={<CalendarCheck className="w-5 h-5" />}
              accent="teal"
            />
            <StatCard
              label="Patients Waiting"
              value={waitingCount}
              icon={<Activity className="w-5 h-5" />}
              accent="amber"
            />
            <StatCard
              label="Checked In"
              value={checkedInCount}
              icon={<UserCheck className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Under Consultation"
              value={inConsultCount}
              icon={<Stethoscope className="w-5 h-5" />}
              accent="emerald"
            />
          </div>

          {/* Triage & Vitals Modal / Panel */}
          {selectedAppt && (
            <div className="rounded-xl border border-sky-300 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <p className="text-xs font-semibold text-[#0F4C81]">
                    Nursing Triage &amp; Consultant Allocation · {selectedAppt.appointment_code}
                  </p>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {selectedAppt.patient_name} ({selectedAppt.patient_hospital_number})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAppt(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Close Panel
                </button>
              </div>

              <form onSubmit={handleSaveVitalsAndQueue} className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Temperature (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={vitalsForm.temperature_c}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, temperature_c: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Pressure (mmHg)</label>
                  <input
                    type="text"
                    required
                    value={vitalsForm.blood_pressure}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, blood_pressure: e.target.value }))}
                    placeholder="120/80"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pulse Rate (BPM)</label>
                  <input
                    type="number"
                    required
                    value={vitalsForm.pulse_bpm}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, pulse_bpm: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SpO2 (%)</label>
                  <input
                    type="number"
                    value={vitalsForm.spo2_percent}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, spo2_percent: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={vitalsForm.weight_kg}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, weight_kg: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Triage Priority</label>
                  <select
                    value={vitalsForm.priority}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, priority: e.target.value as PriorityLevel }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Direct / Allocate to Consultant Doctor *
                  </label>
                  <select
                    required
                    value={vitalsForm.doctor_id}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, doctor_id: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} — {d.specialization} ({d.consultation_room})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nursing Observations</label>
                  <input
                    type="text"
                    value={vitalsForm.triage_notes}
                    onChange={(e) => setVitalsForm((p) => ({ ...p, triage_notes: e.target.value }))}
                    placeholder="Initial observations, presenting discomfort, mobility notes..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedAppt(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingVitals}
                    className="rounded-lg bg-[#0D9488] px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    {savingVitals ? 'Recording...' : 'Save Vitals & Queue for Doctor'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'queue' && (
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Active Patient Check-In &amp; Consultation Queue
                  </h2>
                  <span className="text-xs text-slate-500">
                    Check in arriving patients, record vitals, and assign doctors
                  </span>
                </div>
                {appointments.filter((a) => a.status !== 'Cancelled' && a.status !== 'Completed').length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<ClipboardCheck className="w-5 h-5" />}
                      title="No active patients in queue"
                      description="Booked appointments and walk-in check-ins will appear here."
                    />
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Queue</th>
                        <th className="py-3 px-4">Patient</th>
                        <th className="py-3 px-4">Schedule</th>
                        <th className="py-3 px-4">Allocated Consultant</th>
                        <th className="py-3 px-4">Latest Vitals</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {appointments
                        .filter((a) => a.status !== 'Cancelled' && a.status !== 'Completed')
                        .map((appt) => {
                          const latestVital = vitals.find((v) => v.appointment_id === appt.id);
                          return (
                            <tr key={appt.id} className="hover:bg-slate-50/70">
                              <td className="py-3 px-4 font-mono text-xs font-bold text-slate-900">
                                {appt.queue_number ? `#${appt.queue_number}` : '—'}
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-semibold text-slate-900">{appt.patient_name}</p>
                                <p className="text-xs font-mono text-slate-500">
                                  {appt.patient_hospital_number} · {appt.appointment_code}
                                </p>
                              </td>
                              <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                {appt.appointment_date} {appt.appointment_time}
                              </td>
                              <td className="py-3 px-4">
                                <select
                                  value={appt.doctor_id || ''}
                                  onChange={(e) => handleAllocateDoctor(appt.id, e.target.value)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                                >
                                  <option value="">Unassigned</option>
                                  {doctors.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.full_name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-3 px-4 text-xs font-mono text-slate-600">
                                {latestVital
                                  ? `${latestVital.temperature_c ?? '-'}°C · ${latestVital.blood_pressure ?? '-'}`
                                  : 'Not recorded'}
                              </td>
                              <td className="py-3 px-4">
                                <StatusBadge status={appt.status} />
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                                {['Booked', 'Approved', 'Rescheduled'].includes(appt.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickCheckIn(appt)}
                                    className="rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-[#0F4C81] hover:bg-sky-100"
                                  >
                                    Check In
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openTriageDrawer(appt)}
                                  className="rounded bg-[#0D9488] px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700"
                                >
                                  {latestVital ? 'Update Vitals' : 'Record Vitals'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'appointments' && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Date &amp; Time</th>
                    <th className="py-3 px-4">Doctor</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {appointments.map((appt) => (
                    <tr key={appt.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold">{appt.appointment_code}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{appt.patient_name}</p>
                        <p className="text-xs font-mono text-slate-500">{appt.patient_hospital_number}</p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{appt.consultation_category}</td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                        {appt.appointment_date} {appt.appointment_time}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{appt.doctor_name || 'Unassigned'}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={appt.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'patients' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, hospital no, matric ID, or phone..."
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Hospital No</th>
                      <th className="py-3 px-4">Full Name</th>
                      <th className="py-3 px-4">Category &amp; ID</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4">Blood / Genotype</th>
                      <th className="py-3 px-4">Allergies</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredPatients.map((pat) => (
                      <tr key={pat.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0F4C81] whitespace-nowrap">
                          {pat.hospital_number}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">{pat.full_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {pat.patient_category}
                          {pat.matric_or_staff_id ? ` · ${pat.matric_or_staff_id}` : ''}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">{pat.phone || '—'}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">
                          {pat.blood_group || 'Unknown'} / {pat.genotype || 'Unknown'}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">{pat.allergies || 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'walkin' && (
            <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-base font-bold text-slate-900">Register Walk-In Patient</h2>
              <p className="text-xs text-slate-500 mt-1">
                Create a hospital file for arriving patients without prior online registration and optionally check them in immediately.
              </p>

              <form onSubmit={handleRegisterWalkIn} className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={walkInForm.full_name}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, full_name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={walkInForm.phone}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
                  <select
                    value={walkInForm.gender}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, gender: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={walkInForm.patient_category}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, patient_category: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                  >
                    <option value="Student">Student</option>
                    <option value="Staff">Staff</option>
                    <option value="Dependent">Dependent</option>
                    <option value="Community">Community</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Matric / Staff ID</label>
                  <input
                    type="text"
                    value={walkInForm.matric_or_staff_id}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, matric_or_staff_id: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Allergies</label>
                  <input
                    type="text"
                    value={walkInForm.allergies}
                    onChange={(e) => setWalkInForm((p) => ({ ...p, allergies: e.target.value }))}
                    placeholder="None known"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 pt-3 border-t border-slate-200">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={walkInForm.book_immediately}
                      onChange={(e) => setWalkInForm((p) => ({ ...p, book_immediately: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    <span>Also create &amp; check in today&apos;s outpatient visit immediately</span>
                  </label>
                </div>

                {walkInForm.book_immediately && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                      <select
                        value={walkInForm.department_id}
                        onChange={(e) => setWalkInForm((p) => ({ ...p, department_id: e.target.value }))}
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
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Presenting Complaint *</label>
                      <input
                        type="text"
                        required={walkInForm.book_immediately}
                        value={walkInForm.reason}
                        onChange={(e) => setWalkInForm((p) => ({ ...p, reason: e.target.value }))}
                        placeholder="e.g., Acute fever and headache"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                      />
                    </div>
                  </>
                )}

                <div className="sm:col-span-2 flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingWalkIn}
                    className="rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
                  >
                    {savingWalkIn ? 'Registering...' : 'Register Walk-In Patient'}
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
