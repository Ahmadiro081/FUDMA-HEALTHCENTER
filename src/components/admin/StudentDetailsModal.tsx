import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Calendar,
  FileText,
  GraduationCap,
  HeartPulse,
  Pencil,
  Pill,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { StudentAccountSummary, StudentDetailRecord } from '../../types/hospital';
import { StatusBadge } from '../ui/StatusBadge';

interface StudentDetailsModalProps {
  patientId: string | null;
  onClose: () => void;
  onEdit: (student: StudentAccountSummary) => void;
  onToggleActive: (student: StudentAccountSummary) => Promise<void>;
  togglingId?: string | null;
}

export function StudentDetailsModal({
  patientId,
  onClose,
  onEdit,
  onToggleActive,
  togglingId,
}: StudentDetailsModalProps) {
  const [detail, setDetail] = useState<StudentDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!patientId) {
      setDetail(null);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    api.admin
      .getStudentDetail(patientId)
      .then((res) => {
        if (!cancelled) {
          setDetail(res.student);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load student details.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!patientId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-detail-title"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50/70">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <GraduationCap className="w-5 h-5 text-[#0F4C81] shrink-0" />
              <h2 id="student-detail-title" className="text-base font-bold text-slate-900 truncate">
                {detail ? detail.full_name : 'Student Profile Details'}
              </h2>
              {detail && (
                <StatusBadge
                  status={
                    detail.user_id
                      ? detail.is_active
                        ? 'Active'
                        : 'Inactive'
                      : 'Walk-in Record'
                  }
                />
              )}
            </div>
            {detail && (
              <p className="mt-1 text-xs font-mono text-slate-600">
                Matric: <span className="font-semibold text-slate-900">{detail.matric_number || '—'}</span>
                {' · '}
                Hospital No: <span className="font-semibold text-[#0F4C81]">{detail.hospital_number}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close student details"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-24 rounded-lg bg-slate-100" />
              <div className="h-32 rounded-lg bg-slate-100" />
              <div className="h-24 rounded-lg bg-slate-100" />
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : detail ? (
            <>
              {/* Academic & Portal Sync Section */}
              <section className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-[#0F4C81]" />
                  <span>Academic &amp; Portal Identity</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Matriculation Number</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {detail.matric_number || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Academic Department</span>
                    <span className="font-medium text-slate-900">{detail.department || 'Unspecified'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Hospital Number</span>
                    <span className="font-mono font-semibold text-[#0F4C81]">{detail.hospital_number}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Portal Login Status</span>
                    <span className="font-medium text-slate-900">
                      {detail.has_auth_account || detail.user_id
                        ? detail.is_active
                          ? 'Active (Can Sign In)'
                          : 'Deactivated (Login & Sessions Blocked)'
                        : 'No Auth Login Linked'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Whitelist Sync</span>
                    <span className="font-medium text-slate-900">
                      {detail.is_whitelisted ? 'Synchronized in Whitelist' : 'Direct / Clinical Record'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Created On</span>
                    <span className="font-mono text-slate-700">
                      {new Date(detail.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </section>

              {/* Personal & Contact Section */}
              <section className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  <FileText className="w-4 h-4 text-[#0F4C81]" />
                  <span>Personal &amp; Contact Information</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Full Name</span>
                    <span className="font-semibold text-slate-900">{detail.full_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Email Address</span>
                    <span className="font-mono text-slate-800 break-all">{detail.email || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Phone Number</span>
                    <span className="font-mono text-slate-800">{detail.phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Gender</span>
                    <span className="text-slate-900">{detail.gender || 'Unspecified'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Date of Birth</span>
                    <span className="font-mono text-slate-800">{detail.date_of_birth || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Residential Address</span>
                    <span className="text-slate-800">{detail.address || '—'}</span>
                  </div>
                </div>
              </section>

              {/* Clinical Profile & Emergency Contact */}
              <section className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  <HeartPulse className="w-4 h-4 text-[#0D9488]" />
                  <span>Clinical Baseline &amp; Emergency Contact</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Blood Group</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {detail.blood_group || 'Unknown'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Genotype</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {detail.genotype || 'Unknown'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Known Allergies</span>
                    <span className="text-slate-900">{detail.allergies || 'None reported'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Emergency Contact Name</span>
                    <span className="text-slate-900">{detail.emergency_contact_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Emergency Contact Phone</span>
                    <span className="font-mono text-slate-800">{detail.emergency_contact_phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Last Updated</span>
                    <span className="font-mono text-slate-700">
                      {detail.updated_at ? new Date(detail.updated_at).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>
              </section>

              {/* Clinical Utilization Summary */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  <Activity className="w-4 h-4 text-[#0F4C81]" />
                  <span>Preserved Clinical Records Summary</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    { label: 'Appointments', count: detail.clinical_summary.appointments_count },
                    { label: 'Vitals', count: detail.clinical_summary.vitals_count },
                    { label: 'Consultations', count: detail.clinical_summary.consultations_count },
                    { label: 'Lab Requests', count: detail.clinical_summary.lab_requests_count },
                    { label: 'Prescriptions', count: detail.clinical_summary.prescriptions_count },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center"
                    >
                      <span className="block text-lg font-bold font-mono tabular-nums text-slate-900">
                        {item.count}
                      </span>
                      <span className="block text-[11px] font-medium text-slate-500">{item.label}</span>
                    </div>
                  ))}
                </div>

                {(detail.recent_appointments.length > 0 ||
                  detail.recent_consultations.length > 0 ||
                  detail.recent_prescriptions.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Calendar className="w-3.5 h-3.5 text-[#0F4C81]" />
                        <span>Recent Appointments</span>
                      </div>
                      {detail.recent_appointments.length === 0 ? (
                        <p className="text-slate-400">None recorded</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {detail.recent_appointments.map((a) => (
                            <li key={a.id} className="border-b border-slate-100 pb-1 last:border-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-slate-800">
                                  {a.appointment_code}
                                </span>
                                <span className="text-[11px] text-slate-500">{a.status}</span>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {a.appointment_date} {a.appointment_time}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <FileText className="w-3.5 h-3.5 text-[#0D9488]" />
                        <span>Recent Consultations</span>
                      </div>
                      {detail.recent_consultations.length === 0 ? (
                        <p className="text-slate-400">None recorded</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {detail.recent_consultations.map((c) => (
                            <li key={c.id} className="border-b border-slate-100 pb-1 last:border-0">
                              <p className="font-medium text-slate-800 truncate">{c.diagnosis}</p>
                              <p className="text-[11px] text-slate-500">
                                {c.status} · {new Date(c.created_at).toLocaleDateString()}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Pill className="w-3.5 h-3.5 text-amber-600" />
                        <span>Recent Prescriptions</span>
                      </div>
                      {detail.recent_prescriptions.length === 0 ? (
                        <p className="text-slate-400">None recorded</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {detail.recent_prescriptions.map((p) => (
                            <li key={p.id} className="border-b border-slate-100 pb-1 last:border-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-slate-800">
                                  {p.prescription_code}
                                </span>
                                <span className="text-[11px] text-slate-500">{p.status}</span>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {new Date(p.created_at).toLocaleDateString()}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            Account deactivation blocks portal access while preserving all medical records.
          </span>
          <div className="flex items-center gap-2">
            {detail && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(detail);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit Student</span>
                </button>
                {detail.user_id && (
                  <button
                    type="button"
                    disabled={togglingId === detail.patient_id}
                    onClick={async () => {
                      await onToggleActive(detail);
                      onClose();
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                      detail.is_active
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-emerald-700 hover:bg-emerald-800'
                    }`}
                  >
                    {detail.is_active ? (
                      <>
                        <UserX className="w-3.5 h-3.5" />
                        <span>Deactivate Student</span>
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Activate Student</span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
