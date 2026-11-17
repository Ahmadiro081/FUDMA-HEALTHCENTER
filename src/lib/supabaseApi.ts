import { requireSupabase } from './supabase';
import type {
  ActivityLog,
  AppNotification,
  Appointment,
  Consultation,
  Department,
  DoctorRecord,
  LaboratoryRequest,
  LaboratoryResult,
  MatricVerificationResult,
  Medication,
  PatientRecord,
  PatientVital,
  PharmacyDispensing,
  Prescription,
  PrescriptionItem,
  StaffAccountSummary,
  StudentAccountSummary,
  SystemSettings,
  UserRole,
} from '../types/hospital';

type RawRow = Record<string, unknown>;

function strOrNull(val: unknown): string | null {
  if (val === undefined || val === null || val === '') return null;
  return String(val);
}

function numOrNull(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function one<T>(val: unknown): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return (val[0] as T) || null;
  return val as T;
}

function many<T>(val: unknown): T[] {
  if (!val) return [];
  return Array.isArray(val) ? (val as T[]) : [val as T];
}

function normalizePatient(row: RawRow): PatientRecord {
  const prof = one<RawRow>(row.profiles);
  return {
    id: String(row.id),
    profile_id: strOrNull(row.profile_id),
    hospital_number: String(row.hospital_number),
    matric_or_staff_id: strOrNull(row.matric_or_staff_id),
    patient_category: (row.patient_category as PatientRecord['patient_category']) || 'Student',
    faculty_or_unit: strOrNull(row.faculty_or_unit),
    blood_group: strOrNull(row.blood_group),
    genotype: strOrNull(row.genotype),
    allergies: strOrNull(row.allergies),
    emergency_contact_name: strOrNull(row.emergency_contact_name),
    emergency_contact_phone: strOrNull(row.emergency_contact_phone),
    is_walk_in: Boolean(row.is_walk_in),
    full_name: String(prof?.full_name || row.full_name || 'Patient'),
    email: strOrNull(prof?.email ?? row.email),
    phone: strOrNull(prof?.phone ?? row.phone),
    gender: (strOrNull(prof?.gender ?? row.gender) as PatientRecord['gender']) ?? null,
    date_of_birth: strOrNull(prof?.date_of_birth ?? row.date_of_birth),
    address: strOrNull(prof?.address ?? row.address),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeDoctor(row: RawRow): DoctorRecord {
  const prof = one<RawRow>(row.profiles);
  const dept = one<RawRow>(row.departments);
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    department_id: String(row.department_id),
    department_name: strOrNull(dept?.name) ?? undefined,
    staff_code: String(row.staff_code),
    specialization: String(row.specialization),
    license_number: strOrNull(row.license_number),
    consultation_room: strOrNull(row.consultation_room),
    is_available: Boolean(row.is_available),
    full_name: String(prof?.full_name || 'Medical Officer'),
    email: String(prof?.email || ''),
    phone: strOrNull(prof?.phone),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function extractPatientName(pat: RawRow | null): string {
  if (!pat) return 'Unknown Patient';
  const prof = one<RawRow>(pat.profiles);
  return String(prof?.full_name || pat.full_name || 'Patient');
}

function extractDoctorName(doc: RawRow | null): string | null {
  if (!doc) return null;
  const prof = one<RawRow>(doc.profiles);
  return strOrNull(prof?.full_name);
}

function normalizeAppointment(row: RawRow): Appointment {
  const pat = one<RawRow>(row.patients);
  const dept = one<RawRow>(row.departments);
  const doc = one<RawRow>(row.doctors);
  return {
    id: String(row.id),
    appointment_code: String(row.appointment_code),
    patient_id: String(row.patient_id),
    patient_name: pat ? extractPatientName(pat) : undefined,
    patient_hospital_number: strOrNull(pat?.hospital_number) ?? undefined,
    patient_category: strOrNull(pat?.patient_category) ?? undefined,
    department_id: String(row.department_id),
    department_name: strOrNull(dept?.name) ?? undefined,
    doctor_id: strOrNull(row.doctor_id),
    doctor_name: extractDoctorName(doc),
    consultation_category: String(row.consultation_category),
    appointment_date: String(row.appointment_date),
    appointment_time: String(row.appointment_time),
    reason: String(row.reason),
    status: row.status as Appointment['status'],
    queue_number: numOrNull(row.queue_number),
    checked_in_at: strOrNull(row.checked_in_at),
    checked_in_by: strOrNull(row.checked_in_by),
    notes: strOrNull(row.notes),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeVital(row: RawRow): PatientVital {
  const pat = one<RawRow>(row.patients);
  const prof = one<RawRow>(row.profiles);
  return {
    id: String(row.id),
    appointment_id: String(row.appointment_id),
    patient_id: String(row.patient_id),
    patient_name: pat ? extractPatientName(pat) : undefined,
    recorded_by: String(row.recorded_by),
    recorded_by_name: strOrNull(prof?.full_name) ?? 'Nursing Staff',
    temperature_c: numOrNull(row.temperature_c),
    blood_pressure: strOrNull(row.blood_pressure),
    pulse_bpm: numOrNull(row.pulse_bpm),
    respiratory_rate: numOrNull(row.respiratory_rate),
    spo2_percent: numOrNull(row.spo2_percent),
    weight_kg: numOrNull(row.weight_kg),
    height_cm: numOrNull(row.height_cm),
    triage_notes: strOrNull(row.triage_notes),
    priority: (row.priority as PatientVital['priority']) || 'Normal',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeConsultation(row: RawRow): Consultation {
  const appt = one<RawRow>(row.appointments);
  const pat = one<RawRow>(row.patients);
  const doc = one<RawRow>(row.doctors);
  return {
    id: String(row.id),
    appointment_id: String(row.appointment_id),
    appointment_code: strOrNull(appt?.appointment_code) ?? undefined,
    patient_id: String(row.patient_id),
    patient_name: pat ? extractPatientName(pat) : undefined,
    patient_hospital_number: strOrNull(pat?.hospital_number) ?? undefined,
    doctor_id: String(row.doctor_id),
    doctor_name: extractDoctorName(doc) ?? 'Medical Officer',
    chief_complaint: String(row.chief_complaint),
    clinical_observations: String(row.clinical_observations),
    diagnosis: String(row.diagnosis),
    treatment_plan: strOrNull(row.treatment_plan),
    follow_up_date: strOrNull(row.follow_up_date),
    follow_up_notes: strOrNull(row.follow_up_notes),
    status: row.status as Consultation['status'],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeLabRequest(row: RawRow): LaboratoryRequest {
  const pat = one<RawRow>(row.patients);
  const doc = one<RawRow>(row.doctors);
  const resRaw = one<RawRow>(row.laboratory_results);

  let result: LaboratoryResult | null = null;
  if (resRaw) {
    const resProf = one<RawRow>(resRaw.profiles);
    result = {
      id: String(resRaw.id),
      lab_request_id: String(resRaw.lab_request_id),
      recorded_by: String(resRaw.recorded_by),
      recorded_by_name: strOrNull(resProf?.full_name) ?? undefined,
      findings: String(resRaw.findings),
      numeric_value: strOrNull(resRaw.numeric_value),
      reference_range: strOrNull(resRaw.reference_range),
      interpretation: (resRaw.interpretation as LaboratoryResult['interpretation']) || 'Normal',
      scientist_remarks: strOrNull(resRaw.scientist_remarks),
      reviewed_by_doctor: Boolean(resRaw.reviewed_by_doctor),
      reviewed_at: strOrNull(resRaw.reviewed_at),
      created_at: String(resRaw.created_at),
      updated_at: String(resRaw.updated_at),
    };
  }

  return {
    id: String(row.id),
    request_code: String(row.request_code),
    consultation_id: String(row.consultation_id),
    patient_id: String(row.patient_id),
    patient_name: pat ? extractPatientName(pat) : undefined,
    patient_hospital_number: strOrNull(pat?.hospital_number) ?? undefined,
    doctor_id: String(row.doctor_id),
    doctor_name: extractDoctorName(doc) ?? 'Medical Officer',
    test_name: String(row.test_name),
    test_category: String(row.test_category),
    clinical_notes: strOrNull(row.clinical_notes),
    urgency: (row.urgency as LaboratoryRequest['urgency']) || 'Routine',
    status: row.status as LaboratoryRequest['status'],
    assigned_lab_staff: strOrNull(row.assigned_lab_staff),
    result,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizePrescription(row: RawRow): Prescription {
  const pat = one<RawRow>(row.patients);
  const doc = one<RawRow>(row.doctors);
  const itemsRaw = many<RawRow>(row.prescription_items);
  const dispRaw = many<RawRow>(row.pharmacy_dispensing);

  const items: PrescriptionItem[] = itemsRaw.map((it) => ({
    id: String(it.id),
    prescription_id: String(it.prescription_id),
    medication_id: strOrNull(it.medication_id),
    medication_name: String(it.medication_name),
    dosage: String(it.dosage),
    frequency: String(it.frequency),
    duration: String(it.duration),
    quantity_prescribed: Number(it.quantity_prescribed),
    quantity_dispensed: Number(it.quantity_dispensed),
    availability_status: it.availability_status as PrescriptionItem['availability_status'],
    instructions: strOrNull(it.instructions),
    created_at: String(it.created_at),
    updated_at: String(it.updated_at),
  }));

  const dispensing_records: PharmacyDispensing[] = dispRaw.map((d) => {
    const prof = one<RawRow>(d.profiles);
    return {
      id: String(d.id),
      prescription_id: String(d.prescription_id),
      dispensed_by: String(d.dispensed_by),
      dispensed_by_name: strOrNull(prof?.full_name) ?? 'Pharmacy Staff',
      dispensed_notes: strOrNull(d.dispensed_notes),
      dispensed_at: String(d.dispensed_at),
      created_at: String(d.created_at),
    };
  });

  return {
    id: String(row.id),
    prescription_code: String(row.prescription_code),
    consultation_id: String(row.consultation_id),
    patient_id: String(row.patient_id),
    patient_name: pat ? extractPatientName(pat) : undefined,
    patient_hospital_number: strOrNull(pat?.hospital_number) ?? undefined,
    doctor_id: String(row.doctor_id),
    doctor_name: extractDoctorName(doc) ?? 'Medical Officer',
    status: row.status as Prescription['status'],
    pharmacist_notes: strOrNull(row.pharmacist_notes),
    items,
    dispensing_records,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function getCurrentActor(): Promise<{ id: string; full_name: string; role: UserRole }> {
  const client = requireSupabase();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) {
    throw new Error('Authentication required. Please sign in again.');
  }

  const [profRes, roleRes] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    client.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
  ]);

  return {
    id: user.id,
    full_name: profRes.data?.full_name || String(user.user_metadata?.full_name || user.email || 'User'),
    role: ((roleRes.data?.role as UserRole | undefined) || 'patient'),
  };
}

async function logVerifiedActivity(
  action: string,
  entityType: string,
  entityId: string | null,
  details: string
): Promise<void> {
  try {
    const client = requireSupabase();
    const actor = await getCurrentActor();
    await client.from('activity_logs').insert({
      actor_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch {
    // Audit log insert failure should not obscure successful clinical mutations
  }
}

function formatSupabaseError(error: { message: string } | null, fallback: string): Error {
  return new Error(error?.message || fallback);
}

export const supabaseApi = {
  auth: {
    async verifyMatric(matricNumber: string): Promise<MatricVerificationResult> {
      const client = requireSupabase();
      const norm = matricNumber.trim().replace(/\s+/g, '').toUpperCase();
      const { data, error } = await client.rpc('rpc_verify_group11_matric', {
        p_matric_number: norm,
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Unable to verify matriculation number.');
      }
      return data as MatricVerificationResult;
    },
  },
  reference: {
    async departments(): Promise<{ departments: Department[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('departments')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw formatSupabaseError(error, 'Unable to load departments.');
      return { departments: (data || []) as Department[] };
    },

    async doctors(): Promise<{ doctors: DoctorRecord[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('doctors')
        .select('*, profiles(full_name, email, phone), departments(name)')
        .order('created_at', { ascending: true });
      if (error) throw formatSupabaseError(error, 'Unable to load medical officers.');
      return { doctors: (data || []).map((d) => normalizeDoctor(d as RawRow)) };
    },

    async publicSettings(): Promise<{ settings: SystemSettings }> {
      const client = requireSupabase();
      const { data, error } = await client.from('system_settings').select('*').limit(1).maybeSingle();
      if (error) throw formatSupabaseError(error, 'Unable to load clinic settings.');
      if (!data) {
        return {
          settings: {
            id: 'default',
            hospital_name: 'FUDMA HEALTHCENTER',
            institution_name: 'Federal University Dutsin-Ma',
            clinic_hours: '08:00 - 18:00 (24/7 Emergency Triage)',
            max_daily_appointments: 120,
            allow_patient_cancellations: true,
            appointment_slot_minutes: 30,
            updated_at: new Date().toISOString(),
          },
        };
      }
      return { settings: data as SystemSettings };
    },
  },

  patients: {
    async list(q?: string): Promise<{ patients: PatientRecord[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('patients')
        .select('*, profiles(full_name, email, phone, gender, date_of_birth, address)')
        .order('created_at', { ascending: false });
      if (error) throw formatSupabaseError(error, 'Unable to load patient records.');
      let list = (data || []).map((row) => normalizePatient(row as RawRow));
      if (q && q.trim()) {
        const needle = q.trim().toLowerCase();
        list = list.filter(
          (p) =>
            p.full_name.toLowerCase().includes(needle) ||
            p.hospital_number.toLowerCase().includes(needle) ||
            (p.matric_or_staff_id || '').toLowerCase().includes(needle) ||
            (p.phone || '').toLowerCase().includes(needle)
        );
      }
      return { patients: list };
    },

    async createWalkIn(payload: Record<string, unknown>): Promise<{ patient: PatientRecord }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_register_walk_in_patient', {
        p_full_name: String(payload.full_name || '').trim(),
        p_phone: String(payload.phone || '').trim(),
        p_gender: String(payload.gender || 'Male'),
        p_patient_category: String(payload.patient_category || 'Student'),
        p_matric_or_staff_id: strOrNull(payload.matric_or_staff_id),
        p_blood_group: String(payload.blood_group || 'Unknown'),
        p_allergies: strOrNull(payload.allergies),
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Walk-in patient registration failed.');
      }
      return { patient: normalizePatient(data as RawRow) };
    },

    async update(id: string, payload: Record<string, unknown>): Promise<{ patient: PatientRecord }> {
      const client = requireSupabase();
      const actor = await getCurrentActor();

      if (actor.role === 'patient') {
        const restricted = [
          'hospital_number',
          'matric_or_staff_id',
          'patient_category',
          'faculty_or_unit',
          'full_name',
          'is_walk_in',
          'profile_id',
        ];
        for (const key of restricted) {
          if (payload[key] !== undefined) {
            throw new Error(`Patients cannot modify restricted field (${key}).`);
          }
        }
      } else if (!['nurse', 'admin', 'super_admin'].includes(actor.role)) {
        throw new Error('Insufficient permissions to update patient demographics.');
      }

      const patientPatch: RawRow = {};
      if (actor.role !== 'patient' && payload.full_name !== undefined && String(payload.full_name).trim()) {
        patientPatch.full_name = String(payload.full_name).trim();
      }
      if (payload.phone !== undefined) patientPatch.phone = strOrNull(payload.phone);
      if (payload.gender !== undefined) patientPatch.gender = strOrNull(payload.gender);
      if (payload.date_of_birth !== undefined) patientPatch.date_of_birth = strOrNull(payload.date_of_birth);
      if (payload.address !== undefined) patientPatch.address = strOrNull(payload.address);
      if (payload.blood_group !== undefined && payload.blood_group !== '') {
        patientPatch.blood_group = String(payload.blood_group);
      }
      if (payload.genotype !== undefined && payload.genotype !== '') {
        patientPatch.genotype = String(payload.genotype);
      }
      if (payload.allergies !== undefined) patientPatch.allergies = strOrNull(payload.allergies);
      if (payload.emergency_contact_name !== undefined) {
        patientPatch.emergency_contact_name = strOrNull(payload.emergency_contact_name);
      }
      if (payload.emergency_contact_phone !== undefined) {
        patientPatch.emergency_contact_phone = strOrNull(payload.emergency_contact_phone);
      }

      if (actor.role !== 'patient') {
        if (payload.matric_or_staff_id !== undefined) {
          patientPatch.matric_or_staff_id = strOrNull(payload.matric_or_staff_id);
        }
        if (payload.patient_category !== undefined && payload.patient_category !== '') {
          patientPatch.patient_category = String(payload.patient_category);
        }
        if (payload.faculty_or_unit !== undefined) {
          patientPatch.faculty_or_unit = strOrNull(payload.faculty_or_unit);
        }
      }

      const { data: updated, error } = await client
        .from('patients')
        .update(patientPatch)
        .eq('id', id)
        .select('*, profiles(full_name, email, phone, gender, date_of_birth, address)')
        .single();

      if (error || !updated) {
        throw formatSupabaseError(error, 'Failed to update patient profile.');
      }

      const profileId = strOrNull((updated as RawRow).profile_id);
      if (profileId && (profileId === actor.id || actor.role === 'admin' || actor.role === 'super_admin')) {
        const profilePatch: RawRow = {};
        if (patientPatch.full_name !== undefined) profilePatch.full_name = patientPatch.full_name;
        if (patientPatch.phone !== undefined) profilePatch.phone = patientPatch.phone;
        if (patientPatch.gender !== undefined) profilePatch.gender = patientPatch.gender;
        if (patientPatch.date_of_birth !== undefined) profilePatch.date_of_birth = patientPatch.date_of_birth;
        if (patientPatch.address !== undefined) profilePatch.address = patientPatch.address;

        if (Object.keys(profilePatch).length > 0) {
          const { error: profErr } = await client
            .from('profiles')
            .update(profilePatch)
            .eq('id', profileId);
          if (profErr) {
            throw formatSupabaseError(profErr, 'Failed to sync user profile details.');
          }
        }
      }

      const { data: refreshed, error: refErr } = await client
        .from('patients')
        .select('*, profiles(full_name, email, phone, gender, date_of_birth, address)')
        .eq('id', id)
        .single();

      if (refErr || !refreshed) {
        throw formatSupabaseError(refErr, 'Failed to reload updated patient record.');
      }

      const normalized = normalizePatient(refreshed as RawRow);
      await logVerifiedActivity(
        'PATIENT_UPDATED',
        'patient',
        normalized.hospital_number,
        `Updated demographics for ${normalized.full_name}.`
      );
      return { patient: normalized };
    },
  },

  appointments: {
    async list(): Promise<{ appointments: Appointment[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('appointments')
        .select(
          '*, patients(hospital_number, patient_category, full_name, profiles(full_name)), departments(name), doctors(profiles(full_name))'
        )
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false });
      if (error) throw formatSupabaseError(error, 'Unable to load appointments.');
      return { appointments: (data || []).map((row) => normalizeAppointment(row as RawRow)) };
    },

    async create(payload: Record<string, unknown>): Promise<{ appointment: Appointment }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_book_appointment', {
        p_patient_id: strOrNull(payload.patient_id),
        p_department_id: String(payload.department_id),
        p_consultation_category: String(payload.consultation_category || 'General Consultation'),
        p_appointment_date: String(payload.appointment_date),
        p_appointment_time: String(payload.appointment_time),
        p_reason: String(payload.reason || ''),
        p_doctor_id: strOrNull(payload.doctor_id),
        p_auto_check_in: Boolean(payload.auto_check_in),
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to book appointment.');
      }
      return { appointment: normalizeAppointment(data as RawRow) };
    },

    async update(id: string, payload: Record<string, unknown>): Promise<{ appointment: Appointment }> {
      const client = requireSupabase();
      const hasDoctor = Object.prototype.hasOwnProperty.call(payload, 'doctor_id');
      const { data, error } = await client.rpc('rpc_update_appointment', {
        p_appointment_id: id,
        p_status: payload.status !== undefined ? String(payload.status) : null,
        p_doctor_id: hasDoctor ? strOrNull(payload.doctor_id) : null,
        p_update_doctor: hasDoctor,
        p_notes: payload.notes !== undefined ? strOrNull(payload.notes) : null,
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to update appointment.');
      }
      return { appointment: normalizeAppointment(data as RawRow) };
    },
  },

  vitals: {
    async list(patientId?: string): Promise<{ vitals: PatientVital[] }> {
      const client = requireSupabase();
      let query = client
        .from('patient_vitals')
        .select('*, patients(full_name, profiles(full_name)), profiles(full_name)')
        .order('created_at', { ascending: false });

      if (patientId) {
        query = query.eq('patient_id', patientId);
      }

      const { data, error } = await query;
      if (error) throw formatSupabaseError(error, 'Unable to load patient vitals.');
      return { vitals: (data || []).map((row) => normalizeVital(row as RawRow)) };
    },

    async create(payload: Record<string, unknown>): Promise<{ vital: PatientVital; appointment: Appointment }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_record_vitals_and_queue', {
        p_appointment_id: String(payload.appointment_id),
        p_temperature_c: numOrNull(payload.temperature_c),
        p_blood_pressure: strOrNull(payload.blood_pressure),
        p_pulse_bpm: intOrNull(payload.pulse_bpm),
        p_respiratory_rate: intOrNull(payload.respiratory_rate),
        p_spo2_percent: intOrNull(payload.spo2_percent),
        p_weight_kg: numOrNull(payload.weight_kg),
        p_height_cm: numOrNull(payload.height_cm),
        p_priority: String(payload.priority || 'Normal'),
        p_doctor_id: strOrNull(payload.doctor_id),
        p_triage_notes: strOrNull(payload.triage_notes),
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to record vital signs.');
      }
      const bundle = data as { vital: RawRow; appointment: RawRow };
      return {
        vital: normalizeVital(bundle.vital),
        appointment: normalizeAppointment(bundle.appointment),
      };
    },
  },

  consultations: {
    async list(): Promise<{ consultations: Consultation[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('consultations')
        .select(
          '*, appointments(appointment_code), patients(hospital_number, full_name, profiles(full_name)), doctors(profiles(full_name))'
        )
        .order('created_at', { ascending: false });
      if (error) throw formatSupabaseError(error, 'Unable to load consultations.');
      return { consultations: (data || []).map((row) => normalizeConsultation(row as RawRow)) };
    },

    async save(payload: Record<string, unknown>): Promise<{ consultation: Consultation }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_save_consultation', {
        p_appointment_id: String(payload.appointment_id),
        p_chief_complaint: String(payload.chief_complaint || '').trim(),
        p_clinical_observations: String(payload.clinical_observations || '').trim(),
        p_diagnosis: String(payload.diagnosis || '').trim(),
        p_treatment_plan: strOrNull(payload.treatment_plan),
        p_follow_up_date: strOrNull(payload.follow_up_date),
        p_follow_up_notes: strOrNull(payload.follow_up_notes),
        p_status: String(payload.status || 'In Progress'),
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to save consultation.');
      }
      return { consultation: normalizeConsultation(data as RawRow) };
    },
  },

  laboratory: {
    async list(): Promise<{ requests: LaboratoryRequest[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('laboratory_requests')
        .select(
          '*, patients(hospital_number, full_name, profiles(full_name)), doctors(profiles(full_name)), laboratory_results(*, profiles(full_name))'
        )
        .order('created_at', { ascending: false });
      if (error) throw formatSupabaseError(error, 'Unable to load laboratory requests.');
      return { requests: (data || []).map((row) => normalizeLabRequest(row as RawRow)) };
    },

    async create(payload: Record<string, unknown>): Promise<{ request: LaboratoryRequest }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_create_lab_request', {
        p_consultation_id: String(payload.consultation_id),
        p_test_name: String(payload.test_name || '').trim(),
        p_test_category: String(payload.test_category || 'General Diagnostics'),
        p_urgency: String(payload.urgency || 'Routine'),
        p_clinical_notes: strOrNull(payload.clinical_notes),
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to submit laboratory request.');
      }
      return { request: normalizeLabRequest(data as RawRow) };
    },

    async update(id: string, payload: Record<string, unknown>): Promise<{ request: LaboratoryRequest }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_update_lab_request', {
        p_lab_request_id: id,
        p_status: payload.status !== undefined ? String(payload.status) : null,
        p_findings: payload.findings !== undefined ? strOrNull(payload.findings) : null,
        p_numeric_value: payload.numeric_value !== undefined ? strOrNull(payload.numeric_value) : null,
        p_reference_range: payload.reference_range !== undefined ? strOrNull(payload.reference_range) : null,
        p_interpretation: payload.interpretation !== undefined ? String(payload.interpretation) : 'Normal',
        p_scientist_remarks: payload.scientist_remarks !== undefined ? strOrNull(payload.scientist_remarks) : null,
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to update laboratory request.');
      }
      return { request: normalizeLabRequest(data as RawRow) };
    },
  },

  pharmacy: {
    async medications(): Promise<{ medications: Medication[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('medications')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw formatSupabaseError(error, 'Unable to load formulary medications.');
      return { medications: (data || []) as Medication[] };
    },

    async addMedication(payload: Record<string, unknown>): Promise<{ medication: Medication }> {
      const client = requireSupabase();
      const name = String(payload.name || '').trim();
      const genericName = String(payload.generic_name || '').trim();
      const category = String(payload.category || '').trim();
      const dosageForm = String(payload.dosage_form || '').trim();
      const strength = String(payload.strength || '').trim();
      if (!name || !genericName || !category || !dosageForm || !strength) {
        throw new Error('All medication specification fields are required.');
      }

      const sku = `MED-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const stockQty = Math.max(0, Number(payload.stock_quantity || 0));
      const reorderLvl = Math.max(0, Number(payload.reorder_level || 20));

      const { data, error } = await client
        .from('medications')
        .insert({
          sku,
          name,
          generic_name: genericName,
          category,
          dosage_form: dosageForm,
          strength,
          stock_quantity: stockQty,
          reorder_level: reorderLvl,
          unit_label: payload.unit_label ? String(payload.unit_label).trim() : 'Packs',
          expiry_date: strOrNull(payload.expiry_date),
        })
        .select('*')
        .single();

      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to add medication.');
      }

      await logVerifiedActivity(
        'MEDICATION_ADDED',
        'medication',
        sku,
        `Added ${name} (${stockQty} units) to inventory.`
      );
      return { medication: data as Medication };
    },

    async updateMedication(id: string, payload: Record<string, unknown>): Promise<{ medication: Medication }> {
      const client = requireSupabase();
      const patch: RawRow = {};
      if (payload.stock_quantity !== undefined) {
        const qty = Number(payload.stock_quantity);
        if (!Number.isFinite(qty) || qty < 0) {
          throw new Error('Medication stock quantity must be a non-negative number.');
        }
        patch.stock_quantity = Math.round(qty);
      }
      if (payload.reorder_level !== undefined) {
        const lvl = Number(payload.reorder_level);
        if (!Number.isFinite(lvl) || lvl < 0) {
          throw new Error('Reorder level must be a non-negative number.');
        }
        patch.reorder_level = Math.round(lvl);
      }
      if (payload.expiry_date !== undefined) {
        patch.expiry_date = strOrNull(payload.expiry_date);
      }

      const { data, error } = await client
        .from('medications')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();

      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to update medication inventory.');
      }

      const med = data as Medication;
      await logVerifiedActivity(
        'STOCK_UPDATED',
        'medication',
        med.sku,
        `Updated ${med.name} stock to ${med.stock_quantity} ${med.unit_label}.`
      );
      return { medication: med };
    },

    async prescriptions(): Promise<{ prescriptions: Prescription[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('prescriptions')
        .select(
          '*, patients(hospital_number, full_name, profiles(full_name)), doctors(profiles(full_name)), prescription_items(*), pharmacy_dispensing(*, profiles(full_name))'
        )
        .order('created_at', { ascending: false });
      if (error) throw formatSupabaseError(error, 'Unable to load prescriptions.');
      return { prescriptions: (data || []).map((row) => normalizePrescription(row as RawRow)) };
    },

    async createPrescription(payload: Record<string, unknown>): Promise<{ prescription: Prescription }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_create_prescription', {
        p_consultation_id: String(payload.consultation_id),
        p_items: payload.items || [],
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to issue prescription.');
      }
      return { prescription: normalizePrescription(data as RawRow) };
    },

    async updatePrescription(id: string, payload: Record<string, unknown>): Promise<{ prescription: Prescription }> {
      const client = requireSupabase();
      const { data, error } = await client.rpc('rpc_dispense_prescription', {
        p_prescription_id: id,
        p_status: payload.status !== undefined ? String(payload.status) : null,
        p_pharmacist_notes: payload.pharmacist_notes !== undefined ? strOrNull(payload.pharmacist_notes) : null,
        p_item_updates: payload.item_updates ?? null,
      });
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to dispense prescription.');
      }
      return { prescription: normalizePrescription(data as RawRow) };
    },
  },

  notifications: {
    async list(): Promise<{ notifications: AppNotification[] }> {
      const client = requireSupabase();
      const { data, error } = await client
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw formatSupabaseError(error, 'Unable to load notifications.');
      return { notifications: (data || []) as AppNotification[] };
    },

    async markRead(id: string): Promise<{ ok: boolean }> {
      const client = requireSupabase();
      const { error } = await client.from('notifications').update({ is_read: true }).eq('id', id);
      if (error) throw formatSupabaseError(error, 'Failed to mark notification as read.');
      return { ok: true };
    },

    async markAllRead(): Promise<{ ok: boolean }> {
      const client = requireSupabase();
      const { error } = await client.from('notifications').update({ is_read: true }).eq('is_read', false);
      if (error) throw formatSupabaseError(error, 'Failed to mark notifications as read.');
      return { ok: true };
    },
  },

  admin: {
    async overview(): Promise<{
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
    }> {
      const client = requireSupabase();
      const today = new Date().toISOString().slice(0, 10);

      const [
        patientsCountRes,
        patientsListRes,
        profilesRes,
        rolesRes,
        doctorsRes,
        departmentsRes,
        apptsRes,
        labsPendingRes,
        rxPendingRes,
        medsRes,
        logsRes,
        settingsRes,
        privRes,
      ] = await Promise.all([
        client.from('patients').select('id', { count: 'exact', head: true }),
        client
          .from('patients')
          .select('id, profile_id, hospital_number, matric_or_staff_id, patient_category, faculty_or_unit, blood_group, genotype, is_walk_in, full_name, email, phone, created_at')
          .eq('patient_category', 'Student')
          .order('created_at', { ascending: false }),
        client.from('profiles').select('id, full_name, email, phone, is_active, created_at'),
        client.from('user_roles').select('user_id, role'),
        client.from('doctors').select('profile_id, department_id, specialization, staff_code, consultation_room'),
        client.from('departments').select('*').order('name', { ascending: true }),
        client.from('appointments').select('id, appointment_date'),
        client
          .from('laboratory_requests')
          .select('id', { count: 'exact', head: true })
          .not('status', 'in', '(Completed,Reviewed)'),
        client
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'Pending'),
        client.from('medications').select('stock_quantity, reorder_level'),
        client.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100),
        client.from('system_settings').select('*').limit(1).maybeSingle(),
        client.from('privileged_accounts').select('user_id, login_username'),
      ]);

      const firstError =
        patientsCountRes.error ||
        profilesRes.error ||
        rolesRes.error ||
        doctorsRes.error ||
        departmentsRes.error ||
        apptsRes.error ||
        labsPendingRes.error ||
        rxPendingRes.error ||
        medsRes.error ||
        logsRes.error ||
        settingsRes.error;

      if (firstError) {
        throw formatSupabaseError(firstError, 'Unable to load administrator overview.');
      }

      const departments = (departmentsRes.data || []) as Department[];
      const deptMap = new Map(departments.map((d) => [d.id, d.name]));
      const roleMap = new Map((rolesRes.data || []).map((r) => [String(r.user_id), r.role as UserRole]));
      const docMap = new Map((doctorsRes.data || []).map((d) => [String(d.profile_id), d]));
      const privMap = new Map(
        (!privRes.error && Array.isArray(privRes.data) ? privRes.data : []).map((pr) => [
          String(pr.user_id),
          String(pr.login_username),
        ])
      );

      const staff: StaffAccountSummary[] = (profilesRes.data || [])
        .map((p) => {
          const role = roleMap.get(String(p.id)) || 'patient';
          if (role === 'patient') return null;
          const doc = docMap.get(String(p.id));
          return {
            id: String(p.id),
            full_name: String(p.full_name),
            email: String(p.email),
            phone: strOrNull(p.phone),
            role,
            is_active: Boolean(p.is_active),
            login_username: privMap.get(String(p.id)) || null,
            department_id: doc ? strOrNull(doc.department_id) : null,
            department_name: doc?.department_id ? deptMap.get(String(doc.department_id)) || null : null,
            specialization: doc ? strOrNull(doc.specialization) : null,
            staff_code: doc ? strOrNull(doc.staff_code) : null,
            consultation_room: doc ? strOrNull(doc.consultation_room) : null,
            created_at: String(p.created_at),
          } as StaffAccountSummary;
        })
        .filter((item): item is StaffAccountSummary => item !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      const profileMap = new Map(
        (profilesRes.data || []).map((p) => [String(p.id), p])
      );

      const students: StudentAccountSummary[] = (!patientsListRes.error && Array.isArray(patientsListRes.data)
        ? patientsListRes.data
        : []
      ).map((pat) => {
        const linkedProf = pat.profile_id ? profileMap.get(String(pat.profile_id)) : null;
        return {
          user_id: strOrNull(pat.profile_id),
          patient_id: String(pat.id),
          hospital_number: String(pat.hospital_number),
          matric_number: strOrNull(pat.matric_or_staff_id),
          full_name: String(linkedProf?.full_name || pat.full_name || 'Student'),
          email: strOrNull(linkedProf?.email ?? pat.email),
          department: strOrNull(pat.faculty_or_unit),
          phone: strOrNull(linkedProf?.phone ?? pat.phone),
          blood_group: strOrNull(pat.blood_group),
          genotype: strOrNull(pat.genotype),
          is_active: linkedProf ? Boolean(linkedProf.is_active) : false,
          is_walk_in: Boolean(pat.is_walk_in),
          created_at: String(pat.created_at),
        };
      });

      const appts = apptsRes.data || [];
      const meds = medsRes.data || [];

      const settings: SystemSettings = (settingsRes.data as SystemSettings | null) || {
        id: 'default',
        hospital_name: 'FUDMA HEALTHCENTER',
        institution_name: 'Federal University Dutsin-Ma',
        clinic_hours: '08:00 - 18:00 (24/7 Emergency Triage)',
        max_daily_appointments: 120,
        allow_patient_cancellations: true,
        appointment_slot_minutes: 30,
        updated_at: new Date().toISOString(),
      };

      return {
        stats: {
          total_patients: patientsCountRes.count ?? 0,
          total_staff: staff.length,
          total_appointments: appts.length,
          todays_appointments: appts.filter((a) => a.appointment_date === today).length,
          pending_labs: labsPendingRes.count ?? 0,
          pending_prescriptions: rxPendingRes.count ?? 0,
          low_stock_medications: meds.filter((m) => Number(m.stock_quantity) <= Number(m.reorder_level)).length,
        },
        staff,
        students,
        departments,
        activity_logs: (logsRes.data || []) as ActivityLog[],
        settings,
      };
    },

    async createStudent(payload: Record<string, unknown>): Promise<{ ok: boolean; student: StudentAccountSummary }> {
      const client = requireSupabase();
      const {
        data: { session },
      } = await client.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Active administrator session required to provision student accounts.');
      }

      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        student?: StudentAccountSummary;
      };
      if (!res.ok || !body.student) {
        throw new Error(body.error || `Student provisioning failed with status ${res.status}`);
      }
      return { ok: true, student: body.student };
    },

    async updateStudentStatus(userId: string, isActive: boolean): Promise<{ ok: boolean }> {
      const client = requireSupabase();
      const {
        data: { session },
      } = await client.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Active administrator session required.');
      }

      const res = await fetch('/api/admin/students', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: userId, is_active: isActive }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(body.error || `Failed to update student account status (${res.status}).`);
      }
      return { ok: true };
    },

    async createStaff(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
      const client = requireSupabase();
      const {
        data: { session },
      } = await client.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Active administrator session required to provision staff.');
      }

      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(body.error || `Staff provisioning failed with status ${res.status}`);
      }
      return { ok: true };
    },

    async updateStaff(
      id: string,
      payload: { role?: UserRole; is_active?: boolean }
    ): Promise<{ ok: boolean }> {
      const client = requireSupabase();
      const { error } = await client.rpc('rpc_admin_update_staff', {
        p_target_user_id: id,
        p_role: payload.role ?? null,
        p_is_active: typeof payload.is_active === 'boolean' ? payload.is_active : null,
      });
      if (error) {
        throw formatSupabaseError(error, 'Failed to update staff account.');
      }
      return { ok: true };
    },

    async createDepartment(payload: Record<string, unknown>): Promise<{ department: Department }> {
      const client = requireSupabase();
      const name = String(payload.name || '').trim();
      const code = String(payload.code || '').trim().toUpperCase();
      if (!name || !code) {
        throw new Error('Department name and code are required.');
      }
      const { data, error } = await client
        .from('departments')
        .insert({
          name,
          code,
          description: strOrNull(payload.description),
          location: strOrNull(payload.location),
          is_active: true,
        })
        .select('*')
        .single();

      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to create department.');
      }
      const dept = data as Department;
      await logVerifiedActivity('DEPARTMENT_CREATED', 'department', dept.code, `Added department ${dept.name}.`);
      return { department: dept };
    },

    async updateDepartment(id: string, payload: Record<string, unknown>): Promise<{ department: Department }> {
      const client = requireSupabase();
      const patch: RawRow = {};
      if (typeof payload.is_active === 'boolean') patch.is_active = payload.is_active;
      if (payload.location !== undefined) patch.location = strOrNull(payload.location);
      if (payload.description !== undefined) patch.description = strOrNull(payload.description);

      const { data, error } = await client
        .from('departments')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) {
        throw formatSupabaseError(error, 'Failed to update department.');
      }
      const dept = data as Department;
      await logVerifiedActivity(
        'DEPARTMENT_UPDATED',
        'department',
        dept.code,
        `Updated department ${dept.name} (active: ${dept.is_active}).`
      );
      return { department: dept };
    },

    async updateSettings(payload: Partial<SystemSettings>): Promise<{ settings: SystemSettings }> {
      const client = requireSupabase();
      const { data: existing, error: fetchErr } = await client
        .from('system_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (fetchErr) {
        throw formatSupabaseError(fetchErr, 'Failed to locate clinic settings record.');
      }

      const patch: RawRow = {};
      if (payload.clinic_hours) patch.clinic_hours = String(payload.clinic_hours).trim();
      if (payload.max_daily_appointments !== undefined) {
        patch.max_daily_appointments = Math.max(10, Number(payload.max_daily_appointments));
      }
      if (typeof payload.allow_patient_cancellations === 'boolean') {
        patch.allow_patient_cancellations = payload.allow_patient_cancellations;
      }
      if (payload.appointment_slot_minutes !== undefined) {
        patch.appointment_slot_minutes = Math.max(10, Number(payload.appointment_slot_minutes));
      }

      const result = existing
        ? await client.from('system_settings').update(patch).eq('id', existing.id).select('*').single()
        : await client.from('system_settings').insert(patch).select('*').single();

      if (result.error || !result.data) {
        throw formatSupabaseError(result.error, 'Failed to save system settings.');
      }

      const settings = result.data as SystemSettings;
      await logVerifiedActivity(
        'SETTINGS_UPDATED',
        'system_settings',
        settings.id,
        'Updated hospital scheduling and policy settings.'
      );
      return { settings };
    },
  },
};
