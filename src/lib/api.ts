import { isSupabaseConfigured } from './supabase';
import { supabaseApi } from './supabaseApi';
import type {
  ActivityLog,
  AppNotification,
  Appointment,
  AuthUser,
  Consultation,
  Department,
  DoctorRecord,
  LaboratoryRequest,
  MatricVerificationResult,
  Medication,
  PatientRecord,
  PatientVital,
  Prescription,
  StaffAccountSummary,
  StudentAccountSummary,
  SystemSettings,
  UserRole,
} from '../types/hospital';

const TOKEN_STORAGE_KEY = 'fudma_hc_token';

export function getStoredToken(): string | null {
  if (isSupabaseConfigured()) {
    return null;
  }
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token && !isSupabaseConfigured()) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    // Always purge any legacy localStorage token from prior sessions
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function assertLocalDevAllowed(): void {
  if (isSupabaseConfigured()) {
    throw new Error('Express local API is bypassed while Supabase backend is active.');
  }
  if (import.meta.env.PROD) {
    throw new Error(
      'Production Supabase configuration missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; local JSON fallback is disabled in production.'
    );
  }
}

async function localRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  assertLocalDevAllowed();
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  auth: {
    verifyMatric: (matricNumber: string): Promise<MatricVerificationResult> =>
      isSupabaseConfigured()
        ? supabaseApi.auth.verifyMatric(matricNumber)
        : localRequest<MatricVerificationResult>('/api/auth/verify-matric', {
            method: 'POST',
            body: JSON.stringify({ matric_number: matricNumber }),
          }),
    register: (payload: Record<string, unknown>) =>
      localRequest<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    login: (identifier: string, password: string) =>
      localRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, email: identifier, password }),
      }),
    logout: () => localRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    me: () => localRequest<{ user: AuthUser }>('/api/auth/me'),
  },
  reference: {
    departments: () =>
      isSupabaseConfigured()
        ? supabaseApi.reference.departments()
        : localRequest<{ departments: Department[] }>('/api/departments'),
    doctors: () =>
      isSupabaseConfigured()
        ? supabaseApi.reference.doctors()
        : localRequest<{ doctors: DoctorRecord[] }>('/api/doctors'),
    publicSettings: () =>
      isSupabaseConfigured()
        ? supabaseApi.reference.publicSettings()
        : localRequest<{ settings: SystemSettings }>('/api/settings/public'),
  },
  patients: {
    list: (q?: string) =>
      isSupabaseConfigured()
        ? supabaseApi.patients.list(q)
        : localRequest<{ patients: PatientRecord[] }>(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    createWalkIn: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.patients.createWalkIn(payload)
        : localRequest<{ patient: PatientRecord }>('/api/patients/walk-in', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    update: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.patients.update(id, payload)
        : localRequest<{ patient: PatientRecord }>(`/api/patients/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
  },
  appointments: {
    list: () =>
      isSupabaseConfigured()
        ? supabaseApi.appointments.list()
        : localRequest<{ appointments: Appointment[] }>('/api/appointments'),
    create: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.appointments.create(payload)
        : localRequest<{ appointment: Appointment }>('/api/appointments', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    update: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.appointments.update(id, payload)
        : localRequest<{ appointment: Appointment }>(`/api/appointments/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
  },
  vitals: {
    list: (patientId?: string) =>
      isSupabaseConfigured()
        ? supabaseApi.vitals.list(patientId)
        : localRequest<{ vitals: PatientVital[] }>(
            `/api/vitals${patientId ? `?patient_id=${encodeURIComponent(patientId)}` : ''}`
          ),
    create: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.vitals.create(payload)
        : localRequest<{ vital: PatientVital; appointment: Appointment }>('/api/vitals', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
  },
  consultations: {
    list: () =>
      isSupabaseConfigured()
        ? supabaseApi.consultations.list()
        : localRequest<{ consultations: Consultation[] }>('/api/consultations'),
    save: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.consultations.save(payload)
        : localRequest<{ consultation: Consultation }>('/api/consultations', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
  },
  laboratory: {
    list: () =>
      isSupabaseConfigured()
        ? supabaseApi.laboratory.list()
        : localRequest<{ requests: LaboratoryRequest[] }>('/api/laboratory/requests'),
    create: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.laboratory.create(payload)
        : localRequest<{ request: LaboratoryRequest }>('/api/laboratory/requests', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    update: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.laboratory.update(id, payload)
        : localRequest<{ request: LaboratoryRequest }>(`/api/laboratory/requests/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
  },
  pharmacy: {
    medications: () =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.medications()
        : localRequest<{ medications: Medication[] }>('/api/pharmacy/medications'),
    addMedication: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.addMedication(payload)
        : localRequest<{ medication: Medication }>('/api/pharmacy/medications', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    updateMedication: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.updateMedication(id, payload)
        : localRequest<{ medication: Medication }>(`/api/pharmacy/medications/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
    prescriptions: () =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.prescriptions()
        : localRequest<{ prescriptions: Prescription[] }>('/api/pharmacy/prescriptions'),
    createPrescription: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.createPrescription(payload)
        : localRequest<{ prescription: Prescription }>('/api/pharmacy/prescriptions', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    updatePrescription: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.pharmacy.updatePrescription(id, payload)
        : localRequest<{ prescription: Prescription }>(`/api/pharmacy/prescriptions/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
  },
  notifications: {
    list: () =>
      isSupabaseConfigured()
        ? supabaseApi.notifications.list()
        : localRequest<{ notifications: AppNotification[] }>('/api/notifications'),
    markRead: (id: string) =>
      isSupabaseConfigured()
        ? supabaseApi.notifications.markRead(id)
        : localRequest<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    markAllRead: () =>
      isSupabaseConfigured()
        ? supabaseApi.notifications.markAllRead()
        : localRequest<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),
  },
  admin: {
    overview: () =>
      isSupabaseConfigured()
        ? supabaseApi.admin.overview()
        : localRequest<{
            stats: {
              total_patients: number;
              total_staff: number;
              total_appointments: number;
              todays_appointments: number;
              pending_labs: number;
              pending_prescriptions: number;
              low_stock_medications: number;
            };
            staff: StaffAccountSummary[];
            students: StudentAccountSummary[];
            departments: Department[];
            activity_logs: ActivityLog[];
            settings: SystemSettings;
          }>('/api/admin/overview'),
    createStaff: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.createStaff(payload)
        : localRequest<{ ok: boolean }>('/api/admin/staff', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    createStudent: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.createStudent(payload)
        : localRequest<{ ok: boolean; student: StudentAccountSummary }>('/api/admin/students', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    updateStudentStatus: (userId: string, isActive: boolean) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.updateStudentStatus(userId, isActive)
        : localRequest<{ ok: boolean }>('/api/admin/students', {
            method: 'PATCH',
            body: JSON.stringify({ user_id: userId, is_active: isActive }),
          }),
    updateStaff: (id: string, payload: { role?: UserRole; is_active?: boolean }) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.updateStaff(id, payload)
        : localRequest<{ ok: boolean }>(`/api/admin/staff/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
    createDepartment: (payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.createDepartment(payload)
        : localRequest<{ department: Department }>('/api/admin/departments', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
    updateDepartment: (id: string, payload: Record<string, unknown>) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.updateDepartment(id, payload)
        : localRequest<{ department: Department }>(`/api/admin/departments/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
    updateSettings: (payload: Partial<SystemSettings>) =>
      isSupabaseConfigured()
        ? supabaseApi.admin.updateSettings(payload)
        : localRequest<{ settings: SystemSettings }>('/api/admin/settings', {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }),
  },
};
