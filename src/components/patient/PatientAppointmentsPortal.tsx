import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarPlus,
  Check,
  Clock,
  Eye,
  Lock,
  Search,
  Stethoscope,
  X,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import type {
  Appointment,
  Department,
  DoctorRecord,
  SystemSettings,
} from '../../types/hospital';

const CLINIC_TIME_SLOTS = [
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
] as const;

const CONSULTATION_CATEGORIES = [
  'General Consultation',
  'Acute Fever & Malaria Review',
  'Student Wellness & Medical Screening',
  'Hypertension & Chronic Review',
  'Respiratory & ENT Review',
  'Preventive & Immunization Counseling',
] as const;

const UPCOMING_STATUSES = new Set([
  'Booked',
  'Approved',
  'Checked In',
  'Waiting',
  'In Consultation',
  'Rescheduled',
]);

const CANCELLABLE_STATUSES = new Set(['Booked', 'Approved', 'Rescheduled']);

export interface ConsultationBookingInput {
  department_id: string;
  doctor_id: string | null;
  consultation_category: string;
  appointment_date: string;
  appointment_time: string;
  reason: string;
}

interface PatientAppointmentsPortalProps {
  mode: 'history' | 'request';
  appointments: Appointment[];
  departments: Department[];
  doctors: DoctorRecord[];
  settings: SystemSettings | null;
  onModeChange: (nextMode: 'history' | 'request') => void;
  onBookSlot: (input: ConsultationBookingInput) => Promise<void>;
  onCancelAppointment: (appointment: Appointment) => Promise<void>;
}

function getLocalTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalTomorrowStr(): string {
  const tomorrow = new Date(Date.now() + 86400000);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSlotElapsedToday(slot: string, selectedDate: string, todayStr: string): boolean {
  if (selectedDate !== todayStr) return false;
  const [hh, mm] = slot.split(':').map(Number);
  const now = new Date();
  const slotMinutes = hh * 60 + mm;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return slotMinutes <= currentMinutes;
}

export function PatientAppointmentsPortal({
  mode,
  appointments,
  departments,
  doctors,
  settings,
  onModeChange,
  onBookSlot,
  onCancelAppointment,
}: PatientAppointmentsPortalProps) {
  const todayStr = getLocalTodayStr();
  const activeDepartments = useMemo(() => departments.filter((d) => d.is_active), [departments]);
  const availableDoctors = useMemo(() => doctors.filter((d) => d.is_available), [doctors]);

  // History filters & inline detail/cancel controls
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'completed' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Request consultation form state
  const [departmentId, setDepartmentId] = useState(activeDepartments[0]?.id || '');
  const [doctorId, setDoctorId] = useState('');
  const [category, setCategory] = useState<string>(CONSULTATION_CATEGORIES[0]);
  const [appointmentDate, setAppointmentDate] = useState(getLocalTomorrowStr);
  const [appointmentTime, setAppointmentTime] = useState('09:00');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!departmentId && activeDepartments[0]?.id) {
      setDepartmentId(activeDepartments[0].id);
    }
  }, [activeDepartments, departmentId]);

  const departmentDoctors = useMemo(() => {
    if (!departmentId) return availableDoctors;
    const matching = availableDoctors.filter((d) => d.department_id === departmentId);
    return matching.length > 0 ? matching : availableDoctors;
  }, [availableDoctors, departmentId]);

  useEffect(() => {
    if (doctorId && !departmentDoctors.some((d) => d.id === doctorId)) {
      setDoctorId('');
    }
  }, [departmentDoctors, doctorId]);

  // Slots already reserved by this authenticated patient on the chosen date
  const occupiedSlotsOnDate = useMemo(() => {
    const reserved = new Set<string>();
    for (const appt of appointments) {
      if (appt.appointment_date === appointmentDate && appt.status !== 'Cancelled') {
        reserved.add(appt.appointment_time);
      }
    }
    return reserved;
  }, [appointments, appointmentDate]);

  // Auto-select first open slot when date changes and current time is blocked
  useEffect(() => {
    if (
      occupiedSlotsOnDate.has(appointmentTime) ||
      isSlotElapsedToday(appointmentTime, appointmentDate, todayStr)
    ) {
      const nextOpen = CLINIC_TIME_SLOTS.find(
        (slot) => !occupiedSlotsOnDate.has(slot) && !isSlotElapsedToday(slot, appointmentDate, todayStr)
      );
      if (nextOpen) {
        setAppointmentTime(nextOpen);
      }
    }
  }, [appointmentDate, appointmentTime, occupiedSlotsOnDate, todayStr]);

  const statusCounts = useMemo(() => {
    let upcoming = 0;
    let completed = 0;
    let cancelled = 0;
    for (const a of appointments) {
      if (UPCOMING_STATUSES.has(a.status)) upcoming += 1;
      else if (a.status === 'Completed') completed += 1;
      else if (a.status === 'Cancelled') cancelled += 1;
    }
    return { all: appointments.length, upcoming, completed, cancelled };
  }, [appointments]);

  const filteredAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appointments.filter((appt) => {
      if (statusFilter === 'upcoming' && !UPCOMING_STATUSES.has(appt.status)) return false;
      if (statusFilter === 'completed' && appt.status !== 'Completed') return false;
      if (statusFilter === 'cancelled' && appt.status !== 'Cancelled') return false;
      if (!q) return true;
      return (
        appt.appointment_code.toLowerCase().includes(q) ||
        appt.consultation_category.toLowerCase().includes(q) ||
        (appt.department_name || '').toLowerCase().includes(q) ||
        (appt.doctor_name || '').toLowerCase().includes(q) ||
        appt.reason.toLowerCase().includes(q) ||
        appt.appointment_date.includes(q)
      );
    });
  }, [appointments, statusFilter, searchQuery]);

  const handleSubmitSlotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanReason = reason.trim();
    if (!departmentId || !activeDepartments.some((d) => d.id === departmentId)) {
      setFormError('Please select an active clinical department.');
      return;
    }
    if (!appointmentDate || appointmentDate < todayStr) {
      setFormError('Consultation date must be today or a future clinic day.');
      return;
    }
    if (!CLINIC_TIME_SLOTS.includes(appointmentTime as (typeof CLINIC_TIME_SLOTS)[number])) {
      setFormError('Please choose a valid consultation slot between 08:00 and 17:30.');
      return;
    }
    if (occupiedSlotsOnDate.has(appointmentTime)) {
      setFormError('You already have an active appointment reserved for this date and time slot.');
      return;
    }
    if (isSlotElapsedToday(appointmentTime, appointmentDate, todayStr)) {
      setFormError('This consultation slot has already elapsed for today. Select a later slot.');
      return;
    }
    if (cleanReason.length < 10) {
      setFormError('Please describe your symptoms or visit purpose (at least 10 characters).');
      return;
    }
    if (cleanReason.length > 500) {
      setFormError('Reason for visit cannot exceed 500 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await onBookSlot({
        department_id: departmentId,
        doctor_id: doctorId || null,
        consultation_category: category,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime,
        reason: cleanReason,
      });
      setReason('');
      setDoctorId('');
      onModeChange('history');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to book consultation slot.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async (appt: Appointment) => {
    setCancellingId(appt.id);
    try {
      await onCancelAppointment(appt);
      setConfirmCancelId(null);
      if (selectedAppt?.id === appt.id) {
        setSelectedAppt(null);
      }
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top workspace mode bar */}
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            {mode === 'request' ? 'Request Consultation Slot' : 'Appointment History & Queue Tracker'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Clinic Hours: {settings?.clinic_hours || '08:00 - 18:00'} · Slot Interval:{' '}
            <span className="font-mono tabular-nums">{settings?.appointment_slot_minutes || 30}m</span> · Authenticated Session Protected
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => onModeChange('history')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'history' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Appointment History ({appointments.length})</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('request')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'request' ? 'bg-[#0F4C81] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            <span>Request New Slot</span>
          </button>
        </div>
      </div>

      {mode === 'request' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleSubmitSlotRequest}
            className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">New Outpatient Consultation Request</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bookings are strictly bound to your verified patient record and checked against daily clinic capacity.
                </p>
              </div>
              <Lock className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" aria-hidden="true" />
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="req-dept" className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Department *
                </label>
                <select
                  id="req-dept"
                  required
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                >
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="req-category" className="block text-xs font-semibold text-slate-700 mb-1">
                  Consultation Category *
                </label>
                <select
                  id="req-category"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
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
                <label htmlFor="req-date" className="block text-xs font-semibold text-slate-700 mb-1">
                  Preferred Date *
                </label>
                <input
                  id="req-date"
                  type="date"
                  required
                  min={todayStr}
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums focus:border-[#0369A1] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="req-doctor" className="block text-xs font-semibold text-slate-700 mb-1">
                  Preferred Clinician (Optional)
                </label>
                <select
                  id="req-doctor"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#0369A1] focus:outline-none"
                >
                  <option value="">Assign available medical officer at triage</option>
                  {departmentDoctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.full_name} ({doc.specialization})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Select Consultation Time Slot ({appointmentDate}) *
                </label>
                <span className="text-[11px] text-slate-500 font-mono">30-min clinic slots</span>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {CLINIC_TIME_SLOTS.map((slot) => {
                  const isOccupied = occupiedSlotsOnDate.has(slot);
                  const isElapsed = isSlotElapsedToday(slot, appointmentDate, todayStr);
                  const disabled = isOccupied || isElapsed;
                  const isSelected = appointmentTime === slot && !disabled;

                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={disabled}
                      aria-pressed={isSelected}
                      onClick={() => setAppointmentTime(slot)}
                      title={
                        isOccupied
                          ? 'Already booked on this date'
                          : isElapsed
                            ? 'Slot elapsed for today'
                            : `Select ${slot}`
                      }
                      className={`rounded-lg border px-2.5 py-2 text-xs font-mono font-semibold tabular-nums transition-colors ${
                        disabled
                          ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed line-through'
                          : isSelected
                            ? 'border-[#0F4C81] bg-[#0F4C81] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-[#0369A1] hover:text-[#0F4C81]'
                      }`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
              {occupiedSlotsOnDate.size > 0 && (
                <p className="mt-2 text-[11px] text-amber-800">
                  Crossed-out times indicate slots you have already reserved on {appointmentDate}.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="req-reason" className="block text-xs font-semibold text-slate-700">
                  Symptoms / Reason for Visit *
                </label>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {reason.trim().length}/500
                </span>
              </div>
              <textarea
                id="req-reason"
                required
                minLength={10}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Briefly describe your symptoms, onset duration, or purpose of medical review..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => onModeChange('history')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Back to History
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>{submitting ? 'Confirming Slot...' : 'Confirm Consultation Slot'}</span>
              </button>
            </div>
          </form>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 space-y-4 h-fit">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Stethoscope className="w-4 h-4 text-[#0F4C81]" />
              <h3 className="text-sm font-bold text-slate-900">Booking Summary</h3>
            </div>
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="text-slate-500">Selected Department</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">
                  {activeDepartments.find((d) => d.id === departmentId)?.name || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Consultation Type</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">{category}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Date &amp; Slot</dt>
                <dd className="font-mono font-semibold text-[#0F4C81] tabular-nums mt-0.5">
                  {appointmentDate} · {appointmentTime}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Cancellation Policy</dt>
                <dd className="text-slate-700 mt-0.5">
                  {settings?.allow_patient_cancellations === false
                    ? 'Self-service cancellations are disabled; contact the Nursing Desk to reschedule.'
                    : 'You may cancel un-checked-in slots prior to nursing triage.'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Daily Clinic Limit</dt>
                <dd className="font-mono tabular-nums text-slate-700 mt-0.5">
                  Up to {settings?.max_daily_appointments || 120} outpatient bookings/day
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(
                [
                  { id: 'all', label: `All (${statusCounts.all})` },
                  { id: 'upcoming', label: `Upcoming (${statusCounts.upcoming})` },
                  { id: 'completed', label: `Completed (${statusCounts.completed})` },
                  { id: 'cancelled', label: `Cancelled (${statusCounts.cancelled})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code, category, doctor..."
                aria-label="Search appointment history"
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
              />
            </div>
          </div>

          {filteredAppointments.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title={
                appointments.length === 0
                  ? 'No appointments recorded yet'
                  : 'No appointments match your current filter'
              }
              description={
                appointments.length === 0
                  ? 'Request your first outpatient consultation slot at FUDMA Healthcenter.'
                  : 'Try clearing the search query or switching status filter tabs.'
              }
              action={
                <button
                  type="button"
                  onClick={() => onModeChange('request')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  <span>Request Consultation Slot</span>
                </button>
              }
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
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAppointments.map((appt) => {
                    const canCancel =
                      settings?.allow_patient_cancellations !== false &&
                      CANCELLABLE_STATUSES.has(appt.status);
                    const isConfirming = confirmCancelId === appt.id;
                    const isBusy = cancellingId === appt.id;

                    return (
                      <tr key={appt.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                          {appt.appointment_code}
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm font-medium text-slate-900">{appt.consultation_category}</p>
                          <p className="text-xs text-slate-500">{appt.department_name || 'General Outpatient'}</p>
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
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedAppt((curr) => (curr?.id === appt.id ? null : appt))
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Details</span>
                            </button>

                            {canCancel && !isConfirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmCancelId(appt.id)}
                                className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Cancel</span>
                              </button>
                            )}

                            {canCancel && isConfirming && (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleConfirmCancel(appt)}
                                  className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{isBusy ? 'Cancelling...' : 'Confirm'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setConfirmCancelId(null)}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                >
                                  Keep
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Read-only clinical appointment detail summary */}
          {selectedAppt && (
            <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-bold text-[#0F4C81] tabular-nums">
                      {selectedAppt.appointment_code}
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {selectedAppt.appointment_date} at {selectedAppt.appointment_time}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">
                    {selectedAppt.consultation_category}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedAppt.status} />
                  <button
                    type="button"
                    onClick={() => setSelectedAppt(null)}
                    aria-label="Close appointment details"
                    className="rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="font-semibold text-slate-500 block">Department &amp; Clinician</span>
                  <p className="text-slate-900 font-medium mt-0.5">
                    {selectedAppt.department_name || 'General Outpatient'}
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    {selectedAppt.doctor_name || 'Pending triage allocation'}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block">Reported Symptoms / Reason</span>
                  <p className="text-slate-800 mt-0.5 leading-relaxed">{selectedAppt.reason}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block">Triage &amp; Queue Notes</span>
                  <p className="text-slate-700 mt-0.5">
                    {selectedAppt.notes || 'No clinical triage remarks recorded yet.'}
                  </p>
                  {selectedAppt.checked_in_at && (
                    <p className="mt-1 font-mono text-[11px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Checked in: {new Date(selectedAppt.checked_in_at).toLocaleString()}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
