import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  FlaskConical,
  Microscope,
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
import { EmptyState, LoadingSkeleton } from '../components/ui/EmptyState';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type { LabStatus, LaboratoryRequest } from '../types/hospital';

export function LabDashboard() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('queue');
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<LaboratoryRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | LabStatus>('all');

  // Result Entry Form
  const [selectedRequest, setSelectedRequest] = useState<LaboratoryRequest | null>(null);
  const [resultForm, setResultForm] = useState({
    findings: '',
    numeric_value: '',
    reference_range: '',
    interpretation: 'Normal' as 'Normal' | 'Abnormal' | 'Critical',
    scientist_remarks: '',
  });
  const [submittingResult, setSubmittingResult] = useState(false);

  const loadLabs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.laboratory.list();
      setRequests(res.requests);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load laboratory queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadLabs();
  }, [loadLabs]);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === 'Pending').length,
    [requests]
  );
  const processingCount = useMemo(
    () => requests.filter((r) => r.status === 'Sample Collected' || r.status === 'Processing').length,
    [requests]
  );
  const completedCount = useMemo(
    () => requests.filter((r) => r.status === 'Completed' || r.status === 'Reviewed').length,
    [requests]
  );

  const chartData = useMemo(
    () => [
      { stage: 'Pending', count: requests.filter((r) => r.status === 'Pending').length },
      { stage: 'Collected', count: requests.filter((r) => r.status === 'Sample Collected').length },
      { stage: 'Processing', count: requests.filter((r) => r.status === 'Processing').length },
      { stage: 'Completed', count: requests.filter((r) => r.status === 'Completed').length },
      { stage: 'Reviewed', count: requests.filter((r) => r.status === 'Reviewed').length },
    ],
    [requests]
  );

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleAdvanceStatus = async (req: LaboratoryRequest, nextStatus: LabStatus) => {
    try {
      await api.laboratory.update(req.id, { status: nextStatus });
      showToast(`${req.request_code} updated to ${nextStatus}`, 'success');
      await loadLabs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    }
  };

  const openResultForm = (req: LaboratoryRequest) => {
    setSelectedRequest(req);
    setResultForm({
      findings: req.result?.findings || '',
      numeric_value: req.result?.numeric_value || '',
      reference_range: req.result?.reference_range || '',
      interpretation: req.result?.interpretation || 'Normal',
      scientist_remarks: req.result?.scientist_remarks || '',
    });
  };

  const handleSubmitResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !resultForm.findings.trim()) {
      showToast('Diagnostic findings are required.', 'error');
      return;
    }
    setSubmittingResult(true);
    try {
      await api.laboratory.update(selectedRequest.id, {
        status: 'Completed',
        ...resultForm,
      });
      showToast(
        `Results submitted for ${selectedRequest.request_code}`,
        'success',
        'Consultant doctor and patient have been notified.'
      );
      setSelectedRequest(null);
      await loadLabs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to submit laboratory results', 'error');
    } finally {
      setSubmittingResult(false);
    }
  };

  const navItems: SidebarNavItem[] = [
    {
      id: 'queue',
      label: 'Test Requests Queue',
      icon: <FlaskConical className="w-4 h-4" />,
      badgeCount: pendingCount + processingCount,
    },
    { id: 'completed', label: 'Completed Results', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout
      portalTitle="Medical Laboratory"
      breadcrumb={activeTab === 'queue' ? 'Diagnostic Test Queue' : 'Completed Lab Results'}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Pending Requests"
              value={pendingCount}
              icon={<Clock className="w-5 h-5" />}
              accent="amber"
            />
            <StatCard
              label="Collected / Processing"
              value={processingCount}
              icon={<Microscope className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Completed & Reviewed"
              value={completedCount}
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent="emerald"
            />
            <StatCard
              label="Total Investigations"
              value={requests.length}
              icon={<FlaskConical className="w-5 h-5" />}
              accent="teal"
            />
          </div>

          {selectedRequest && (
            <div className="rounded-xl border border-teal-300 bg-white p-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <p className="text-xs font-mono font-semibold text-[#0D9488]">
                    Submit Diagnostic Report · {selectedRequest.request_code}
                  </p>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {selectedRequest.test_name} — {selectedRequest.patient_name} ({selectedRequest.patient_hospital_number})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRequest(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>

              <form onSubmit={handleSubmitResult} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Laboratory Findings *</label>
                  <textarea
                    required
                    rows={3}
                    value={resultForm.findings}
                    onChange={(e) => setResultForm((p) => ({ ...p, findings: e.target.value }))}
                    placeholder="Detailed microscopy, hematology, or biochemical findings..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Measured Value</label>
                  <input
                    type="text"
                    value={resultForm.numeric_value}
                    onChange={(e) => setResultForm((p) => ({ ...p, numeric_value: e.target.value }))}
                    placeholder="e.g., 4.9 mmol/L or PCV 42%"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Reference Range</label>
                  <input
                    type="text"
                    value={resultForm.reference_range}
                    onChange={(e) => setResultForm((p) => ({ ...p, reference_range: e.target.value }))}
                    placeholder="e.g., 3.9 – 5.5 mmol/L"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Clinical Interpretation</label>
                  <select
                    value={resultForm.interpretation}
                    onChange={(e) =>
                      setResultForm((p) => ({
                        ...p,
                        interpretation: e.target.value as 'Normal' | 'Abnormal' | 'Critical',
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Abnormal">Abnormal</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Scientist Remarks</label>
                  <input
                    type="text"
                    value={resultForm.scientist_remarks}
                    onChange={(e) => setResultForm((p) => ({ ...p, scientist_remarks: e.target.value }))}
                    placeholder="Method / sample quality notes"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRequest(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingResult}
                    className="rounded-lg bg-[#0D9488] px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    {submittingResult ? 'Submitting...' : 'Submit Results for Doctor Review'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'queue' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
                  {(['all', 'Pending', 'Sample Collected', 'Processing', 'Completed', 'Reviewed'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                        statusFilter === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {s === 'all' ? 'All' : s}
                    </button>
                  ))}
                </div>

                {filteredRequests.length === 0 ? (
                  <EmptyState
                    icon={<FlaskConical className="w-5 h-5" />}
                    title="No laboratory requests in this status"
                    description="Consultant lab orders will appear here in real time."
                  />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Request</th>
                          <th className="py-3 px-4">Patient</th>
                          <th className="py-3 px-4">Test &amp; Category</th>
                          <th className="py-3 px-4">Urgency</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Workflow Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredRequests.map((req) => (
                          <tr key={req.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-mono text-xs font-semibold">{req.request_code}</td>
                            <td className="py-3 px-4">
                              <p className="font-semibold text-slate-900">{req.patient_name}</p>
                              <p className="text-xs font-mono text-slate-500">{req.patient_hospital_number}</p>
                            </td>
                            <td className="py-3 px-4">
                              <p className="text-sm font-medium text-slate-900">{req.test_name}</p>
                              <p className="text-xs text-slate-500">{req.test_category}</p>
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={req.urgency} />
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={req.status} />
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                              {req.status === 'Pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleAdvanceStatus(req, 'Sample Collected')}
                                  className="rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-[#0F4C81]"
                                >
                                  Collect Sample
                                </button>
                              )}
                              {req.status === 'Sample Collected' && (
                                <button
                                  type="button"
                                  onClick={() => handleAdvanceStatus(req, 'Processing')}
                                  className="rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-[#0F4C81]"
                                >
                                  Start Processing
                                </button>
                              )}
                              {req.status !== 'Reviewed' && (
                                <button
                                  type="button"
                                  onClick={() => openResultForm(req)}
                                  className="rounded bg-[#0D9488] px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700"
                                >
                                  {req.result ? 'Edit Result' : 'Enter Result'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900">Laboratory Workload by Stage</h3>
                <p className="text-xs text-slate-500 mt-0.5">Distribution of diagnostic requests</p>
                <div className="h-64 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="stage" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0D9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'completed' && (
            <div className="space-y-3">
              {requests
                .filter((r) => r.result)
                .map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                      <div>
                        <span className="font-mono text-xs font-semibold text-slate-900">{r.request_code}</span>
                        <span className="text-xs text-slate-500 ml-2">
                          {r.patient_name} ({r.patient_hospital_number}) · Ordered by {r.doctor_name}
                        </span>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-900">{r.test_name}</p>
                    <p className="mt-1 text-sm text-slate-700">{r.result?.findings}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 font-mono">
                      <span>Value: {r.result?.numeric_value || '—'}</span>
                      <span>Ref: {r.result?.reference_range || '—'}</span>
                      <StatusBadge status={r.result?.interpretation || 'Normal'} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
