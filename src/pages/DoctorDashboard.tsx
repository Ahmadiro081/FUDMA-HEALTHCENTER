import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Pill,
  Plus,
  Stethoscope,
  Trash2,
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
  Consultation,
  LaboratoryRequest,
  Medication,
  PatientRecord,
  PatientVital,
  Prescription,
} from '../types/hospital';

interface RxDraftItem {
  medication_id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity_prescribed: number;
  instructions: string;
}

export function DoctorDashboard() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('queue');
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [vitals, setVitals] = useState<PatientVital[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [labRequests, setLabRequests] = useState<LaboratoryRequest[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);

  // Active Consultation Workspace
  const [activeAppt, setActiveAppt] = useState<Appointment | null>(null);
  const [conForm, setConForm] = useState({
    chief_complaint: '',
    clinical_observations: '',
    diagnosis: '',
    treatment_plan: '',
    follow_up_date: '',
    follow_up_notes: '',
    status: 'In Progress' as Consultation['status'],
  });
  const [savingCon, setSavingCon] = useState(false);

  // Lab Request Draft inside Consultation
  const [labDraft, setLabDraft] = useState({
    test_name: '',
    test_category: 'Hematology / Parasitology',
    urgency: 'Routine' as 'Routine' | 'Urgent' | 'Stat',
    clinical_notes: '',
  });
  const [orderingLab, setOrderingLab] = useState(false);

  // Prescription Draft inside Consultation
  const [rxItems, setRxItems] = useState<RxDraftItem[]>([]);
  const [issuingRx, setIssuingRx] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, patRes, vitRes, conRes, labRes, rxRes, medRes] = await Promise.all([
        api.appointments.list(),
        api.patients.list(),
        api.vitals.list(),
        api.consultations.list(),
        api.laboratory.list(),
        api.pharmacy.prescriptions(),
        api.pharmacy.medications(),
      ]);
      setAppointments(apptRes.appointments);
      setPatients(patRes.patients);
      setVitals(vitRes.vitals);
      setConsultations(conRes.consultations);
      setLabRequests(labRes.requests);
      setPrescriptions(rxRes.prescriptions);
      setMedications(medRes.medications);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load doctor workspace', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = useMemo(
    () => appointments.filter((a) => a.appointment_date === today),
    [appointments, today]
  );
  const waitingPatients = useMemo(
    () => appointments.filter((a) => a.status === 'Waiting' || a.status === 'Checked In'),
    [appointments]
  );
  const inConsultation = useMemo(
    () => appointments.filter((a) => a.status === 'In Consultation'),
    [appointments]
  );
  const completedConsultations = useMemo(
    () => consultations.filter((c) => c.status === 'Completed'),
    [consultations]
  );
  const pendingLabResults = useMemo(
    () => labRequests.filter((l) => l.status !== 'Reviewed'),
    [labRequests]
  );
  const pendingFollowUps = useMemo(
    () => consultations.filter((c) => Boolean(c.follow_up_date)),
    [consultations]
  );

  const activeConsultation = useMemo(
    () => (activeAppt ? consultations.find((c) => c.appointment_id === activeAppt.id) || null : null),
    [activeAppt, consultations]
  );

  const activePatient = useMemo(
    () => (activeAppt ? patients.find((p) => p.id === activeAppt.patient_id) || null : null),
    [activeAppt, patients]
  );

  const activeVitals = useMemo(
    () => (activeAppt ? vitals.find((v) => v.appointment_id === activeAppt.id) || null : null),
    [activeAppt, vitals]
  );

  const patientHistory = useMemo(
    () =>
      activeAppt
        ? consultations.filter((c) => c.patient_id === activeAppt.patient_id && c.appointment_id !== activeAppt.id)
        : [],
    [activeAppt, consultations]
  );

  const openConsultationWorkspace = async (appt: Appointment) => {
    setActiveAppt(appt);
    const existing = consultations.find((c) => c.appointment_id === appt.id);
    if (existing) {
      setConForm({
        chief_complaint: existing.chief_complaint,
        clinical_observations: existing.clinical_observations,
        diagnosis: existing.diagnosis,
        treatment_plan: existing.treatment_plan || '',
        follow_up_date: existing.follow_up_date || '',
        follow_up_notes: existing.follow_up_notes || '',
        status: existing.status,
      });
    } else {
      setConForm({
        chief_complaint: appt.reason || '',
        clinical_observations: '',
        diagnosis: '',
        treatment_plan: '',
        follow_up_date: '',
        follow_up_notes: '',
        status: 'In Progress',
      });
    }
    if (appt.status === 'Waiting' || appt.status === 'Checked In') {
      try {
        await api.appointments.update(appt.id, { status: 'In Consultation' });
        await loadAll();
      } catch {
        // Non-blocking
      }
    }
    setActiveTab('workspace');
  };

  const handleSaveConsultation = async (e: React.FormEvent, markCompleted = false) => {
    e.preventDefault();
    if (!activeAppt) return;
    if (!conForm.chief_complaint.trim() || !conForm.clinical_observations.trim() || !conForm.diagnosis.trim()) {
      showToast('Chief complaint, observations, and diagnosis are required.', 'error');
      return;
    }
    setSavingCon(true);
    try {
      const targetStatus: Consultation['status'] = markCompleted ? 'Completed' : conForm.status;
      await api.consultations.save({
        appointment_id: activeAppt.id,
        ...conForm,
        status: targetStatus,
      });
      showToast(
        markCompleted ? 'Consultation marked Completed' : 'Consultation notes saved',
        'success'
      );
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save consultation', 'error');
    } finally {
      setSavingCon(false);
    }
  };

  const handleOrderLab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConsultation) {
      showToast('Save the initial consultation notes before ordering a lab test.', 'error');
      return;
    }
    if (!labDraft.test_name.trim()) {
      showToast('Please specify the laboratory test name.', 'error');
      return;
    }
    setOrderingLab(true);
    try {
      await api.laboratory.create({
        consultation_id: activeConsultation.id,
        ...labDraft,
      });
      showToast(`Laboratory request sent for ${labDraft.test_name}`, 'success');
      setLabDraft({
        test_name: '',
        test_category: 'Hematology / Parasitology',
        urgency: 'Routine',
        clinical_notes: '',
      });
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to order lab investigation', 'error');
    } finally {
      setOrderingLab(false);
    }
  };

  const addRxRow = () => {
    const firstMed = medications[0];
    setRxItems((prev) => [
      ...prev,
      {
        medication_id: firstMed?.id || '',
        medication_name: firstMed?.name || '',
        dosage: '1 tablet',
        frequency: 'Twice daily (BD)',
        duration: '5 days',
        quantity_prescribed: 1,
        instructions: 'Take after meals',
      },
    ]);
  };

  const handleIssuePrescription = async () => {
    if (!activeConsultation) {
      showToast('Save the consultation record first before issuing a prescription.', 'error');
      return;
    }
    if (rxItems.length === 0) {
      showToast('Add at least one medication item.', 'error');
      return;
    }
    setIssuingRx(true);
    try {
      await api.pharmacy.createPrescription({
        consultation_id: activeConsultation.id,
        items: rxItems,
      });
      showToast('Prescription sent to Hospital Pharmacy', 'success');
      setRxItems([]);
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to issue prescription', 'error');
    } finally {
      setIssuingRx(false);
    }
  };

  const handleReviewLabResult = async (reqId: string) => {
    try {
      await api.laboratory.update(reqId, { status: 'Reviewed' });
      showToast('Laboratory result marked as Reviewed', 'success');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to mark reviewed', 'error');
    }
  };

  const navItems: SidebarNavItem[] = [
    {
      id: 'queue',
      label: 'Waiting & Appointments',
      icon: <Users className="w-4 h-4" />,
      badgeCount: waitingPatients.length + inConsultation.length,
    },
    {
      id: 'workspace',
      label: 'Consultation Workspace',
      icon: <Stethoscope className="w-4 h-4" />,
    },
    {
      id: 'labs',
      label: 'Laboratory Review',
      icon: <FlaskConical className="w-4 h-4" />,
      badgeCount: labRequests.filter((l) => l.status === 'Completed').length,
    },
    { id: 'history', label: 'Consultations & Follow-Ups', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  const breadcrumbMap: Record<string, string> = {
    queue: 'Doctor Queue & Appointments',
    workspace: 'Clinical Consultation Workspace',
    labs: 'Laboratory Results Review',
    history: 'Consultation History & Follow-Ups',
  };

  return (
    <DashboardLayout
      portalTitle="Consultant / Doctor"
      breadcrumb={breadcrumbMap[activeTab] || 'Doctor Portal'}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard
              label="Today's Appointments"
              value={todaysAppointments.length}
              icon={<Calendar className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Waiting Patients"
              value={waitingPatients.length}
              icon={<Users className="w-5 h-5" />}
              accent="amber"
            />
            <StatCard
              label="Under Consultation"
              value={inConsultation.length}
              icon={<Stethoscope className="w-5 h-5" />}
              accent="teal"
            />
            <StatCard
              label="Completed Visits"
              value={completedConsultations.length}
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent="emerald"
            />
            <StatCard
              label="Pending Lab Review"
              value={pendingLabResults.length}
              icon={<FlaskConical className="w-5 h-5" />}
              accent="amber"
            />
            <StatCard
              label="Follow-Ups Scheduled"
              value={pendingFollowUps.length}
              icon={<CalendarClock className="w-5 h-5" />}
              accent="blue"
            />
          </div>

          {activeTab === 'queue' && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Assigned Appointments &amp; Checked-In Waiting Queue
                </h2>
                <span className="text-xs text-slate-500">Select a patient to open their consultation room</span>
              </div>
              {appointments.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<Stethoscope className="w-5 h-5" />}
                    title="No assigned appointments"
                    description="Patients checked in and allocated to you by Nursing Station will appear here."
                  />
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Queue</th>
                      <th className="py-3 px-4">Patient</th>
                      <th className="py-3 px-4">Reason / Category</th>
                      <th className="py-3 px-4">Schedule</th>
                      <th className="py-3 px-4">Triage Vitals</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {appointments.map((appt) => {
                      const vital = vitals.find((v) => v.appointment_id === appt.id);
                      return (
                        <tr key={appt.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs font-bold">
                            {appt.queue_number ? `#${appt.queue_number}` : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{appt.patient_name}</p>
                            <p className="text-xs font-mono text-slate-500">
                              {appt.patient_hospital_number} · {appt.appointment_code}
                            </p>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="text-xs font-semibold text-slate-800">{appt.consultation_category}</p>
                            <p className="text-xs text-slate-500 truncate">{appt.reason}</p>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                            {appt.appointment_date} {appt.appointment_time}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-slate-600">
                            {vital ? (
                              <span>
                                {vital.temperature_c ?? '-'}°C · {vital.blood_pressure ?? '-'} · {vital.priority}
                              </span>
                            ) : (
                              'Pending triage'
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={appt.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => openConsultationWorkspace(appt)}
                              className="rounded-lg bg-[#0F4C81] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap"
                            >
                              {appt.status === 'Completed' ? 'View Record' : 'Attend Patient'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'workspace' && (
            <>
              {!activeAppt ? (
                <EmptyState
                  icon={<Stethoscope className="w-5 h-5" />}
                  title="Select a patient from the Waiting Queue"
                  description="Choose any checked-in or waiting patient to view vitals, record diagnosis, order lab tests, or prescribe medication."
                  action={
                    <button
                      type="button"
                      onClick={() => setActiveTab('queue')}
                      className="rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white"
                    >
                      Open Waiting Queue
                    </button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Patient Banner, Vitals & Past History */}
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-mono text-[#0F4C81] font-semibold">
                            {activePatient?.hospital_number} · {activeAppt.appointment_code}
                          </p>
                          <h2 className="text-base font-bold text-slate-900 mt-0.5">{activeAppt.patient_name}</h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {activePatient?.patient_category} · {activePatient?.gender || 'N/A'} · Blood:{' '}
                            {activePatient?.blood_group || 'Unknown'} / {activePatient?.genotype || 'Unknown'}
                          </p>
                        </div>
                        <StatusBadge status={activeAppt.status} />
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-700">
                        <p>
                          <span className="font-semibold text-slate-500">Allergies:</span>{' '}
                          {activePatient?.allergies || 'None known'}
                        </p>
                        <p className="mt-1">
                          <span className="font-semibold text-slate-500">Presenting Reason:</span> {activeAppt.reason}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-5">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Nursing Triage Vitals
                      </h3>
                      {activeVitals ? (
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-slate-500 block">Temperature</span>
                            <span className="font-mono font-bold text-slate-900">{activeVitals.temperature_c} °C</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Blood Pressure</span>
                            <span className="font-mono font-bold text-slate-900">{activeVitals.blood_pressure} mmHg</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Pulse</span>
                            <span className="font-mono font-bold text-slate-900">{activeVitals.pulse_bpm} bpm</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">SpO2 / Weight</span>
                            <span className="font-mono font-bold text-slate-900">
                              {activeVitals.spo2_percent ?? '-'}% · {activeVitals.weight_kg ?? '-'}kg
                            </span>
                          </div>
                          {activeVitals.triage_notes && (
                            <div className="col-span-2 pt-2 border-t border-slate-100 text-slate-600">
                              Notes: {activeVitals.triage_notes}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No triage vitals recorded for this visit.</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-5">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Past Consultation History ({patientHistory.length})
                      </h3>
                      {patientHistory.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-500">No previous consultations on record.</p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {patientHistory.map((h) => (
                            <div key={h.id} className="pb-2.5 border-b border-slate-100 last:border-0 text-xs">
                              <p className="font-semibold text-slate-900">{h.diagnosis}</p>
                              <p className="text-slate-500 font-mono">
                                {new Date(h.created_at).toLocaleDateString()} · {h.doctor_name}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Consultation Notes, Lab Order & Prescription Builder */}
                  <div className="lg:col-span-2 space-y-6">
                    <form onSubmit={(e) => handleSaveConsultation(e, false)} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 className="text-sm font-bold text-slate-900">Clinical Notes &amp; Diagnosis</h3>
                        {activeConsultation && <StatusBadge status={activeConsultation.status} />}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Chief Complaint *</label>
                        <input
                          type="text"
                          required
                          value={conForm.chief_complaint}
                          onChange={(e) => setConForm((p) => ({ ...p, chief_complaint: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Clinical Observations &amp; Physical Examination *
                        </label>
                        <textarea
                          required
                          rows={3}
                          value={conForm.clinical_observations}
                          onChange={(e) => setConForm((p) => ({ ...p, clinical_observations: e.target.value }))}
                          placeholder="Document physical examination findings, systemic review, and relevant history..."
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Diagnosis *</label>
                          <input
                            type="text"
                            required
                            value={conForm.diagnosis}
                            onChange={(e) => setConForm((p) => ({ ...p, diagnosis: e.target.value }))}
                            placeholder="e.g., Acute Upper Respiratory Tract Infection"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Follow-Up Date</label>
                          <input
                            type="date"
                            value={conForm.follow_up_date}
                            onChange={(e) => setConForm((p) => ({ ...p, follow_up_date: e.target.value }))}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Treatment Plan &amp; Counseling</label>
                        <textarea
                          rows={2}
                          value={conForm.treatment_plan}
                          onChange={(e) => setConForm((p) => ({ ...p, treatment_plan: e.target.value }))}
                          placeholder="Rest, hydration, dietary advice, medication instructions..."
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Follow-Up Recommendations</label>
                        <input
                          type="text"
                          value={conForm.follow_up_notes}
                          onChange={(e) => setConForm((p) => ({ ...p, follow_up_notes: e.target.value }))}
                          placeholder="e.g., Return in 5 days if fever persists."
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                        <button
                          type="submit"
                          disabled={savingCon}
                          className="rounded-lg border border-[#0F4C81] bg-white px-4 py-2 text-xs font-semibold text-[#0F4C81] hover:bg-sky-50"
                        >
                          {savingCon ? 'Saving...' : 'Save Clinical Notes'}
                        </button>
                        <button
                          type="button"
                          disabled={savingCon}
                          onClick={(e) => handleSaveConsultation(e, true)}
                          className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                        >
                          Complete Consultation
                        </button>
                      </div>
                    </form>

                    {/* Order Laboratory Investigation */}
                    <form onSubmit={handleOrderLab} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 className="text-sm font-bold text-slate-900">Request Laboratory Investigation</h3>
                        <FlaskConical className="w-4 h-4 text-[#0D9488]" />
                      </div>
                      {!activeConsultation && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                          Save initial clinical notes above first to link laboratory requests to this consultation.
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Test Name *</label>
                          <input
                            type="text"
                            value={labDraft.test_name}
                            onChange={(e) => setLabDraft((p) => ({ ...p, test_name: e.target.value }))}
                            placeholder="e.g., Full Blood Count (FBC) & Malaria Parasite"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Urgency</label>
                          <select
                            value={labDraft.urgency}
                            onChange={(e) =>
                              setLabDraft((p) => ({ ...p, urgency: e.target.value as 'Routine' | 'Urgent' | 'Stat' }))
                            }
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                          >
                            <option value="Routine">Routine</option>
                            <option value="Urgent">Urgent</option>
                            <option value="Stat">Stat</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                          <select
                            value={labDraft.test_category}
                            onChange={(e) => setLabDraft((p) => ({ ...p, test_category: e.target.value }))}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                          >
                            <option>Hematology / Parasitology</option>
                            <option>Clinical Chemistry</option>
                            <option>Microbiology &amp; Serology</option>
                            <option>Urinalysis</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Clinical Notes for Lab</label>
                          <input
                            type="text"
                            value={labDraft.clinical_notes}
                            onChange={(e) => setLabDraft((p) => ({ ...p, clinical_notes: e.target.value }))}
                            placeholder="Suspected pathology or sample guidance"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={orderingLab || !activeConsultation}
                          className="rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-50"
                        >
                          {orderingLab ? 'Submitting Request...' : 'Send Lab Request'}
                        </button>
                      </div>
                    </form>

                    {/* Prescribe Medications */}
                    <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 className="text-sm font-bold text-slate-900">Prescribe Medications</h3>
                        <button
                          type="button"
                          onClick={addRxRow}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Drug</span>
                        </button>
                      </div>

                      {rxItems.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Click &ldquo;Add Drug&rdquo; to select medications from the hospital formulary and send a prescription to Pharmacy.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {rxItems.map((item, idx) => (
                            <div key={idx} className="rounded-lg border border-slate-200 p-3 grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
                              <div className="sm:col-span-2">
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Medication</label>
                                <select
                                  value={item.medication_id}
                                  onChange={(e) => {
                                    const med = medications.find((m) => m.id === e.target.value);
                                    setRxItems((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? {
                                              ...row,
                                              medication_id: e.target.value,
                                              medication_name: med?.name || row.medication_name,
                                            }
                                          : row
                                      )
                                    );
                                  }}
                                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                                >
                                  {medications.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name} (Stock: {m.stock_quantity})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Dosage</label>
                                <input
                                  type="text"
                                  value={item.dosage}
                                  onChange={(e) =>
                                    setRxItems((prev) =>
                                      prev.map((row, i) => (i === idx ? { ...row, dosage: e.target.value } : row))
                                    )
                                  }
                                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Frequency</label>
                                <input
                                  type="text"
                                  value={item.frequency}
                                  onChange={(e) =>
                                    setRxItems((prev) =>
                                      prev.map((row, i) => (i === idx ? { ...row, frequency: e.target.value } : row))
                                    )
                                  }
                                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Qty</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={item.quantity_prescribed}
                                  onChange={(e) =>
                                    setRxItems((prev) =>
                                      prev.map((row, i) =>
                                        i === idx ? { ...row, quantity_prescribed: Number(e.target.value) || 1 } : row
                                      )
                                    )
                                  }
                                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setRxItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="p-1.5 rounded text-red-600 hover:bg-red-50"
                                  aria-label="Remove medication row"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}

                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={issuingRx || !activeConsultation}
                              onClick={handleIssuePrescription}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-50"
                            >
                              <Pill className="w-3.5 h-3.5" />
                              <span>{issuingRx ? 'Issuing Prescription...' : 'Send Prescription to Pharmacy'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'labs' && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-900">Laboratory Investigations &amp; Submitted Results</h2>
              {labRequests.length === 0 ? (
                <EmptyState
                  icon={<FlaskConical className="w-5 h-5" />}
                  title="No laboratory requests"
                  description="Lab orders placed during patient consultations will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {labRequests.map((lab) => (
                    <div key={lab.id} className="rounded-lg border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-mono text-slate-500">
                            {lab.request_code} · {lab.patient_name} ({lab.patient_hospital_number}) · {lab.urgency}
                          </p>
                          <h3 className="text-sm font-bold text-slate-900 mt-0.5">{lab.test_name}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={lab.status} />
                          {lab.status === 'Completed' && (
                            <button
                              type="button"
                              onClick={() => handleReviewLabResult(lab.id)}
                              className="rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                            >
                              Mark Reviewed
                            </button>
                          )}
                        </div>
                      </div>
                      {lab.result && (
                        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="font-semibold text-slate-500 block">Findings</span>
                            <span className="text-slate-900 font-medium">{lab.result.findings}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-500 block">Numeric / Reference</span>
                            <span className="font-mono text-slate-800">
                              {lab.result.numeric_value || '—'} ({lab.result.reference_range || 'N/A'})
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-500 block mb-1">Interpretation</span>
                            <StatusBadge status={lab.result.interpretation} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Consultations &amp; Follow-Up Schedule</h2>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Appointment</th>
                      <th className="py-3 px-4">Patient</th>
                      <th className="py-3 px-4">Diagnosis</th>
                      <th className="py-3 px-4">Follow-Up Date</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {consultations.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono text-xs">{c.appointment_code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{c.patient_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-700">{c.diagnosis}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">
                          {c.follow_up_date || 'None'}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Recent Prescriptions Issued</h2>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Rx Code</th>
                      <th className="py-3 px-4">Patient</th>
                      <th className="py-3 px-4">Items</th>
                      <th className="py-3 px-4">Pharmacy Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {prescriptions.map((rx) => (
                      <tr key={rx.id}>
                        <td className="py-3 px-4 font-mono text-xs font-semibold">{rx.prescription_code}</td>
                        <td className="py-3 px-4 text-sm text-slate-900">{rx.patient_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {rx.items.map((i) => i.medication_name).join(', ')}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={rx.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
