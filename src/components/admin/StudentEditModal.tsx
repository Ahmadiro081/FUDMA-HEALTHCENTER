import React, { useEffect, useState } from 'react';
import { AlertCircle, Save, X } from 'lucide-react';
import { api } from '../../lib/api';
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

interface StudentEditModalProps {
  student: StudentAccountSummary | null;
  onClose: () => void;
  onSaved: (updated: StudentAccountSummary) => Promise<void> | void;
}

export function StudentEditModal({ student, onClose, onSaved }: StudentEditModalProps) {
  const [form, setForm] = useState({
    full_name: '',
    matric_number: '',
    department: '',
    email: '',
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!student) return;
    setError('');
    setForm({
      full_name: student.full_name || '',
      matric_number: student.matric_number || '',
      department: student.department || '',
      email: student.email || '',
      phone: student.phone || '',
      gender: (student.gender as '' | 'Male' | 'Female' | 'Other') || '',
      date_of_birth: student.date_of_birth || '',
      address: student.address || '',
      blood_group: student.blood_group || 'Unknown',
      genotype: student.genotype || 'Unknown',
      allergies: student.allergies || '',
      emergency_contact_name: student.emergency_contact_name || '',
      emergency_contact_phone: student.emergency_contact_phone || '',
    });
  }, [student]);

  if (!student) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanName = form.full_name.trim();
    const cleanMatric = form.matric_number.trim().replace(/\s+/g, '').toUpperCase();
    const cleanDept = form.department.trim();
    const cleanEmail = form.email.trim().toLowerCase();

    if (cleanName.length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (!/^[A-Z0-9]+\/\d{4}\/\d+$/.test(cleanMatric)) {
      setError('Matriculation number must match format e.g. ENG/2024/33001.');
      return;
    }
    if (cleanMatric === 'ENG/2011/0001') {
      setError('ENG/2011/0001 is reserved for the Super Administrator and cannot be assigned to a student.');
      return;
    }
    if (cleanDept.length < 2) {
      setError('Academic department is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid student email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.admin.updateStudent({
        patient_id: student.patient_id,
        full_name: cleanName,
        matric_number: cleanMatric,
        department: cleanDept,
        email: cleanEmail,
        phone: form.phone.trim() || null,
        gender: form.gender || null,
        date_of_birth: form.date_of_birth.trim() || null,
        address: form.address.trim() || null,
        blood_group: form.blood_group || 'Unknown',
        genotype: form.genotype || 'Unknown',
        allergies: form.allergies.trim() || 'None reported',
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      });
      await onSaved(res.student);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update student record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-edit-title"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50/70">
          <div>
            <h2 id="student-edit-title" className="text-base font-bold text-slate-900">
              Edit Student Profile
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Changes synchronize across Auth login, Profile, Clinical Patient record (
              <span className="font-mono text-[#0F4C81]">{student.hospital_number}</span>), and Group 11 index.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit modal"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-stu-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name *
              </label>
              <input
                id="edit-stu-name"
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={form.full_name}
                onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-matric" className="block text-xs font-semibold text-slate-700 mb-1">
                Matriculation Number *
              </label>
              <input
                id="edit-stu-matric"
                type="text"
                required
                value={form.matric_number}
                onChange={(e) =>
                  setForm((p) => ({ ...p, matric_number: e.target.value.toUpperCase() }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-dept" className="block text-xs font-semibold text-slate-700 mb-1">
                Academic Department *
              </label>
              <input
                id="edit-stu-dept"
                list="edit-fudma-departments-list"
                required
                value={form.department}
                onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
              <datalist id="edit-fudma-departments-list">
                {FUDMA_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="edit-stu-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address *
              </label>
              <input
                id="edit-stu-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                id="edit-stu-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-gender" className="block text-xs font-semibold text-slate-700 mb-1">
                Gender
              </label>
              <select
                id="edit-stu-gender"
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
              <label htmlFor="edit-stu-dob" className="block text-xs font-semibold text-slate-700 mb-1">
                Date of Birth
              </label>
              <input
                id="edit-stu-dob"
                type="date"
                value={form.date_of_birth}
                onChange={(e) => setForm((p) => ({ ...p, date_of_birth: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-address" className="block text-xs font-semibold text-slate-700 mb-1">
                Address / Hostel
              </label>
              <input
                id="edit-stu-address"
                type="text"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-blood" className="block text-xs font-semibold text-slate-700 mb-1">
                Blood Group
              </label>
              <select
                id="edit-stu-blood"
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
              <label htmlFor="edit-stu-genotype" className="block text-xs font-semibold text-slate-700 mb-1">
                Genotype
              </label>
              <select
                id="edit-stu-genotype"
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
              <label htmlFor="edit-stu-em-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Emergency Contact Name
              </label>
              <input
                id="edit-stu-em-name"
                type="text"
                value={form.emergency_contact_name}
                onChange={(e) => setForm((p) => ({ ...p, emergency_contact_name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-stu-em-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Emergency Contact Phone
              </label>
              <input
                id="edit-stu-em-phone"
                type="tel"
                value={form.emergency_contact_phone}
                onChange={(e) => setForm((p) => ({ ...p, emergency_contact_phone: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="edit-stu-allergies" className="block text-xs font-semibold text-slate-700 mb-1">
                Known Allergies
              </label>
              <input
                id="edit-stu-allergies"
                type="text"
                placeholder="None reported"
                value={form.allergies}
                onChange={(e) => setForm((p) => ({ ...p, allergies: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0369A1] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{submitting ? 'Saving & Syncing...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
