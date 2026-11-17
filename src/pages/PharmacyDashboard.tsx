import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Package,
  Pill,
  Plus,
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
import type { Medication, Prescription, PrescriptionStatus } from '../types/hospital';

export function PharmacyDashboard() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState('prescriptions');
  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [rxFilter, setRxFilter] = useState<'all' | PrescriptionStatus>('all');
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [dispenseNotes, setDispenseNotes] = useState('');
  const [dispensing, setDispensing] = useState(false);

  // Add Medication Form
  const [showAddMed, setShowAddMed] = useState(false);
  const [newMed, setNewMed] = useState({
    name: '',
    generic_name: '',
    category: 'Antibiotic',
    dosage_form: 'Tablet',
    strength: '',
    stock_quantity: 100,
    reorder_level: 25,
    unit_label: 'Packs',
    expiry_date: '2028-01-30',
  });
  const [savingMed, setSavingMed] = useState(false);

  const loadPharmacy = useCallback(async () => {
    setLoading(true);
    try {
      const [rxRes, medRes] = await Promise.all([
        api.pharmacy.prescriptions(),
        api.pharmacy.medications(),
      ]);
      setPrescriptions(rxRes.prescriptions);
      setMedications(medRes.medications);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load pharmacy records', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadPharmacy();
  }, [loadPharmacy]);

  const pendingRxCount = useMemo(
    () => prescriptions.filter((p) => p.status === 'Pending' || p.status === 'Available').length,
    [prescriptions]
  );
  const dispensedRxCount = useMemo(
    () => prescriptions.filter((p) => p.status === 'Dispensed').length,
    [prescriptions]
  );
  const lowStockMeds = useMemo(
    () => medications.filter((m) => m.stock_quantity <= m.reorder_level),
    [medications]
  );
  const availableMedCount = useMemo(
    () => medications.filter((m) => m.stock_quantity > 0).length,
    [medications]
  );

  const filteredRx = useMemo(() => {
    if (rxFilter === 'all') return prescriptions;
    return prescriptions.filter((p) => p.status === rxFilter);
  }, [prescriptions, rxFilter]);

  const stockChartData = useMemo(
    () =>
      medications.slice(0, 8).map((m) => ({
        name: m.name.split(' ')[0],
        stock: m.stock_quantity,
        reorder: m.reorder_level,
      })),
    [medications]
  );

  const handleUpdateRxStatus = async (rx: Prescription, status: PrescriptionStatus, notes?: string) => {
    setDispensing(true);
    try {
      await api.pharmacy.updatePrescription(rx.id, {
        status,
        pharmacist_notes: notes ?? dispenseNotes,
      });
      showToast(`Prescription ${rx.prescription_code} updated to ${status}`, 'success');
      setSelectedRx(null);
      setDispenseNotes('');
      await loadPharmacy();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update prescription', 'error');
    } finally {
      setDispensing(false);
    }
  };

  const handleRestock = async (med: Medication, delta: number) => {
    try {
      await api.pharmacy.updateMedication(med.id, {
        stock_quantity: Math.max(0, med.stock_quantity + delta),
      });
      showToast(`Updated ${med.name} stock`, 'success');
      await loadPharmacy();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update stock', 'error');
    }
  };

  const handleAddMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMed(true);
    try {
      await api.pharmacy.addMedication(newMed);
      showToast(`Added ${newMed.name} to dispensary inventory`, 'success');
      setShowAddMed(false);
      setNewMed({
        name: '',
        generic_name: '',
        category: 'Antibiotic',
        dosage_form: 'Tablet',
        strength: '',
        stock_quantity: 100,
        reorder_level: 25,
        unit_label: 'Packs',
        expiry_date: '2028-01-30',
      });
      await loadPharmacy();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add medication', 'error');
    } finally {
      setSavingMed(false);
    }
  };

  const navItems: SidebarNavItem[] = [
    {
      id: 'prescriptions',
      label: 'Prescriptions Queue',
      icon: <Pill className="w-4 h-4" />,
      badgeCount: pendingRxCount,
    },
    {
      id: 'inventory',
      label: 'Drug Inventory',
      icon: <Package className="w-4 h-4" />,
      badgeCount: lowStockMeds.length,
    },
    { id: 'history', label: 'Dispensing Records', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  const breadcrumbMap: Record<string, string> = {
    prescriptions: 'Prescription Fulfillment Queue',
    inventory: 'Medication Inventory & Stock Control',
    history: 'Dispensing History Log',
  };

  return (
    <DashboardLayout
      portalTitle="Hospital Pharmacy"
      breadcrumb={breadcrumbMap[activeTab] || 'Hospital Pharmacy'}
      navItems={navItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerAction={
        <button
          type="button"
          onClick={() => {
            setActiveTab('inventory');
            setShowAddMed(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Medication</span>
        </button>
      }
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Pending Prescriptions"
              value={pendingRxCount}
              icon={<Pill className="w-5 h-5" />}
              accent="amber"
            />
            <StatCard
              label="Available Formulary Items"
              value={availableMedCount}
              icon={<Package className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              label="Dispensed Prescriptions"
              value={dispensedRxCount}
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent="emerald"
            />
            <StatCard
              label="Low-Stock Alerts"
              value={lowStockMeds.length}
              icon={<AlertTriangle className="w-5 h-5" />}
              accent="red"
            />
          </div>

          {selectedRx && (
            <div className="rounded-xl border border-sky-300 bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <p className="text-xs font-mono font-semibold text-[#0F4C81]">
                    Dispense Prescription · {selectedRx.prescription_code}
                  </p>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {selectedRx.patient_name} ({selectedRx.patient_hospital_number}) · Prescribed by {selectedRx.doctor_name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRx(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {selectedRx.items.map((item) => {
                  const inv = medications.find((m) => m.id === item.medication_id);
                  return (
                    <div key={item.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-sm text-slate-900">{item.medication_name}</p>
                        <p className="text-slate-600">
                          {item.dosage} · {item.frequency} · {item.duration} (Qty: {item.quantity_prescribed})
                        </p>
                      </div>
                      <div className="font-mono text-slate-700">
                        {inv ? `Stock available: ${inv.stock_quantity} ${inv.unit_label}` : 'External / Custom'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pharmacist Counseling / Dispensing Notes
                </label>
                <input
                  type="text"
                  value={dispenseNotes}
                  onChange={(e) => setDispenseNotes(e.target.value)}
                  placeholder="Counseling instructions given to patient or availability note..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={dispensing}
                  onClick={() => handleUpdateRxStatus(selectedRx, 'Unavailable')}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Mark Unavailable
                </button>
                <button
                  type="button"
                  disabled={dispensing}
                  onClick={() => handleUpdateRxStatus(selectedRx, 'Available')}
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-[#0F4C81]"
                >
                  Mark Available
                </button>
                <button
                  type="button"
                  disabled={dispensing}
                  onClick={() => handleUpdateRxStatus(selectedRx, 'Partially Dispensed')}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                >
                  Partially Dispensed
                </button>
                <button
                  type="button"
                  disabled={dispensing}
                  onClick={() => handleUpdateRxStatus(selectedRx, 'Dispensed')}
                  className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  {dispensing ? 'Processing...' : 'Dispense Full Prescription'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'prescriptions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
                {(['all', 'Pending', 'Available', 'Partially Dispensed', 'Dispensed', 'Unavailable'] as const).map(
                  (status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setRxFilter(status)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                        rxFilter === status ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {status === 'all' ? 'All' : status}
                    </button>
                  )
                )}
              </div>

              {filteredRx.length === 0 ? (
                <EmptyState
                  icon={<Pill className="w-5 h-5" />}
                  title="No prescriptions in this view"
                  description="Prescriptions sent by consultant doctors will appear here."
                />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Rx Code</th>
                        <th className="py-3 px-4">Patient</th>
                        <th className="py-3 px-4">Doctor</th>
                        <th className="py-3 px-4">Medications</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredRx.map((rx) => (
                        <tr key={rx.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs font-semibold">{rx.prescription_code}</td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{rx.patient_name}</p>
                            <p className="text-xs font-mono text-slate-500">{rx.patient_hospital_number}</p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700">{rx.doctor_name}</td>
                          <td className="py-3 px-4 text-xs text-slate-700">
                            {rx.items.map((i) => `${i.medication_name} (${i.dosage})`).join(', ')}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={rx.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRx(rx);
                                setDispenseNotes(rx.pharmacist_notes || '');
                              }}
                              className="rounded-lg bg-[#0F4C81] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap"
                            >
                              {rx.status === 'Dispensed' ? 'View' : 'Verify & Dispense'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="space-y-6">
              {showAddMed && (
                <form onSubmit={handleAddMedication} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Add Medication to Inventory</h3>
                    <button
                      type="button"
                      onClick={() => setShowAddMed(false)}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Brand / Product Name *"
                      value={newMed.name}
                      onChange={(e) => setNewMed((p) => ({ ...p, name: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Generic Name *"
                      value={newMed.generic_name}
                      onChange={(e) => setNewMed((p) => ({ ...p, generic_name: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Strength (e.g., 500mg) *"
                      value={newMed.strength}
                      onChange={(e) => setNewMed((p) => ({ ...p, strength: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Category (e.g., Antibiotic)"
                      value={newMed.category}
                      onChange={(e) => setNewMed((p) => ({ ...p, category: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Initial Stock"
                      value={newMed.stock_quantity}
                      onChange={(e) => setNewMed((p) => ({ ...p, stock_quantity: Number(e.target.value) }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Reorder Threshold"
                      value={newMed.reorder_level}
                      onChange={(e) => setNewMed((p) => ({ ...p, reorder_level: Number(e.target.value) }))}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingMed}
                      className="rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white"
                    >
                      {savingMed ? 'Saving...' : 'Save Medication'}
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">SKU</th>
                        <th className="py-3 px-4">Medication</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Stock</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Adjust Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {medications.map((m) => {
                        const isLow = m.stock_quantity <= m.reorder_level;
                        return (
                          <tr key={m.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-mono text-xs">{m.sku}</td>
                            <td className="py-3 px-4">
                              <p className="font-semibold text-slate-900">{m.name}</p>
                              <p className="text-xs text-slate-500">
                                {m.generic_name} · {m.dosage_form} {m.strength}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700">{m.category}</td>
                            <td className="py-3 px-4 font-mono text-xs tabular-nums font-bold text-slate-900">
                              {m.stock_quantity} {m.unit_label}
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={isLow ? 'Low Stock' : 'Available'} />
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                              <button
                                type="button"
                                onClick={() => handleRestock(m, 25)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-mono font-semibold text-slate-800 hover:bg-slate-100"
                              >
                                +25
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRestock(m, -5)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-mono font-semibold text-slate-600 hover:bg-slate-100"
                              >
                                -5
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <h3 className="text-sm font-bold text-slate-900">Dispensary Stock vs. Reorder Level</h3>
                  <div className="h-64 mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stockChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip />
                        <Bar dataKey="stock" name="In Stock" fill="#0F4C81" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="reorder" name="Reorder Level" fill="#D97706" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-900">Pharmacy Dispensing Audit Records</h2>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Rx Code</th>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Dispensed By</th>
                    <th className="py-3 px-4">Notes</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {prescriptions
                    .filter((p) => p.status === 'Dispensed' || p.status === 'Partially Dispensed')
                    .map((rx) => (
                      <tr key={rx.id}>
                        <td className="py-3 px-4 font-mono text-xs font-semibold">{rx.prescription_code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{rx.patient_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {rx.dispensing_records?.[0]?.dispensed_by_name || 'Pharmacy Staff'}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">{rx.pharmacist_notes || '—'}</td>
                        <td className="py-3 px-4">
                          <StatusBadge status={rx.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
