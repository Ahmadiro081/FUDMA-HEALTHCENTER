import type {
  ActivityLog,
  AppNotification,
  Appointment,
  AuthUser,
  Consultation,
  Department,
  DoctorRecord,
  LaboratoryRequest,
  Medication,
  PatientRecord,
  PatientVital,
  Prescription,
  StaffAccountSummary,
  SystemSettings,
  UserRole,
} from '../types/hospital';

const TOKEN_STORAGE_KEY = 'fudma_hc_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    register: (payload: Record<string, unknown>) =>
      request<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    me: () => request<{ user: AuthUser }>('/api/auth/me'),
    resetPassword: (payload: { email: string; new_password: string; hospital_or_staff_check?: string }) =>
      request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },
  reference: {
    departments: () => request<{ departments: Department[] }>('/api/departments'),
    doctors: () => request<{ doctors: DoctorRecord[] }>('/api/doctors'),
    publicSettings: () => request<{ settings: SystemSettings }>('/api/settings/public'),
  },
  patients: {
    list: (q?: string) =>
      request<{ patients: PatientRecord[] }>(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    createWalkIn: (payload: Record<string, unknown>) =>
      request<{ patient: PatientRecord }>('/api/patients/walk-in', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: Record<string, unknown>) =>
      request<{ patient: PatientRecord }>(`/api/patients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
  appointments: {
    list: () => request<{ appointments: Appointment[] }>('/api/appointments'),
    create: (payload: Record<string, unknown>) =>
      request<{ appointment: Appointment }>('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: Record<string, unknown>) =>
      request<{ appointment: Appointment }>(`/api/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
  vitals: {
    list: (patientId?: string) =>
      request<{ vitals: PatientVital[] }>(`/api/vitals${patientId ? `?patient_id=${encodeURIComponent(patientId)}` : ''}`),
    create: (payload: Record<string, unknown>) =>
      request<{ vital: PatientVital; appointment: Appointment }>('/api/vitals', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },
  consultations: {
    list: () => request<{ consultations: Consultation[] }>('/api/consultations'),
    save: (payload: Record<string, unknown>) =>
      request<{ consultation: Consultation }>('/api/consultations', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },
  laboratory: {
    list: () => request<{ requests: LaboratoryRequest[] }>('/api/laboratory/requests'),
    create: (payload: Record<string, unknown>) =>
      request<{ request: LaboratoryRequest }>('/api/laboratory/requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: Record<string, unknown>) =>
      request<{ request: LaboratoryRequest }>(`/api/laboratory/requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
  pharmacy: {
    medications: () => request<{ medications: Medication[] }>('/api/pharmacy/medications'),
    addMedication: (payload: Record<string, unknown>) =>
      request<{ medication: Medication }>('/api/pharmacy/medications', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateMedication: (id: string, payload: Record<string, unknown>) =>
      request<{ medication: Medication }>(`/api/pharmacy/medications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    prescriptions: () => request<{ prescriptions: Prescription[] }>('/api/pharmacy/prescriptions'),
    createPrescription: (payload: Record<string, unknown>) =>
      request<{ prescription: Prescription }>('/api/pharmacy/prescriptions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updatePrescription: (id: string, payload: Record<string, unknown>) =>
      request<{ prescription: Prescription }>(`/api/pharmacy/prescriptions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
  notifications: {
    list: () => request<{ notifications: AppNotification[] }>('/api/notifications'),
    markRead: (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    markAllRead: () => request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),
  },
  admin: {
    overview: () =>
      request<{
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
        departments: Department[];
        activity_logs: ActivityLog[];
        settings: SystemSettings;
      }>('/api/admin/overview'),
    createStaff: (payload: Record<string, unknown>) =>
      request<{ ok: boolean }>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateStaff: (id: string, payload: { role?: UserRole; is_active?: boolean }) =>
      request<{ ok: boolean }>(`/api/admin/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    createDepartment: (payload: Record<string, unknown>) =>
      request<{ department: Department }>('/api/admin/departments', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateDepartment: (id: string, payload: Record<string, unknown>) =>
      request<{ department: Department }>(`/api/admin/departments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    updateSettings: (payload: Partial<SystemSettings>) =>
      request<{ settings: SystemSettings }>('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
};
