export type UserRole = 'patient' | 'nurse' | 'lab' | 'pharmacy' | 'doctor' | 'admin';

export type AppointmentStatus =
  | 'Booked'
  | 'Approved'
  | 'Checked In'
  | 'Waiting'
  | 'In Consultation'
  | 'Completed'
  | 'Cancelled'
  | 'Rescheduled';

export type LabStatus =
  | 'Pending'
  | 'Sample Collected'
  | 'Processing'
  | 'Completed'
  | 'Reviewed';

export type PrescriptionStatus =
  | 'Pending'
  | 'Available'
  | 'Partially Dispensed'
  | 'Dispensed'
  | 'Unavailable';

export type PriorityLevel = 'Normal' | 'Urgent' | 'Emergency';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  gender: 'Male' | 'Female' | 'Other' | null;
  date_of_birth: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientRecord {
  id: string;
  profile_id: string | null;
  hospital_number: string;
  matric_or_staff_id: string | null;
  patient_category: 'Student' | 'Staff' | 'Dependent' | 'Community';
  faculty_or_unit: string | null;
  blood_group: string | null;
  genotype: string | null;
  allergies: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_walk_in: boolean;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: 'Male' | 'Female' | 'Other' | null;
  date_of_birth: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface DoctorRecord {
  id: string;
  profile_id: string;
  department_id: string;
  department_name?: string;
  staff_code: string;
  specialization: string;
  license_number: string | null;
  consultation_room: string | null;
  is_available: boolean;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  appointment_code: string;
  patient_id: string;
  patient_name?: string;
  patient_hospital_number?: string;
  patient_category?: string;
  department_id: string;
  department_name?: string;
  doctor_id: string | null;
  doctor_name?: string | null;
  consultation_category: string;
  appointment_date: string;
  appointment_time: string;
  reason: string;
  status: AppointmentStatus;
  queue_number: number | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientVital {
  id: string;
  appointment_id: string;
  patient_id: string;
  patient_name?: string;
  recorded_by: string;
  recorded_by_name?: string;
  temperature_c: number | null;
  blood_pressure: string | null;
  pulse_bpm: number | null;
  respiratory_rate: number | null;
  spo2_percent: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  triage_notes: string | null;
  priority: PriorityLevel;
  created_at: string;
  updated_at: string;
}

export interface Consultation {
  id: string;
  appointment_id: string;
  appointment_code?: string;
  patient_id: string;
  patient_name?: string;
  patient_hospital_number?: string;
  doctor_id: string;
  doctor_name?: string;
  chief_complaint: string;
  clinical_observations: string;
  diagnosis: string;
  treatment_plan: string | null;
  follow_up_date: string | null;
  follow_up_notes: string | null;
  status: 'In Progress' | 'Awaiting Lab' | 'Completed';
  created_at: string;
  updated_at: string;
}

export interface LaboratoryResult {
  id: string;
  lab_request_id: string;
  recorded_by: string;
  recorded_by_name?: string;
  findings: string;
  numeric_value: string | null;
  reference_range: string | null;
  interpretation: 'Normal' | 'Abnormal' | 'Critical';
  scientist_remarks: string | null;
  reviewed_by_doctor: boolean;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LaboratoryRequest {
  id: string;
  request_code: string;
  consultation_id: string;
  patient_id: string;
  patient_name?: string;
  patient_hospital_number?: string;
  doctor_id: string;
  doctor_name?: string;
  test_name: string;
  test_category: string;
  clinical_notes: string | null;
  urgency: 'Routine' | 'Urgent' | 'Stat';
  status: LabStatus;
  assigned_lab_staff: string | null;
  result?: LaboratoryResult | null;
  created_at: string;
  updated_at: string;
}

export interface Medication {
  id: string;
  sku: string;
  name: string;
  generic_name: string;
  category: string;
  dosage_form: string;
  strength: string;
  stock_quantity: number;
  reorder_level: number;
  unit_label: string;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medication_id: string | null;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity_prescribed: number;
  quantity_dispensed: number;
  availability_status: 'Pending' | 'Available' | 'Dispensed' | 'Unavailable';
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface PharmacyDispensing {
  id: string;
  prescription_id: string;
  dispensed_by: string;
  dispensed_by_name?: string;
  dispensed_notes: string | null;
  dispensed_at: string;
  created_at: string;
}

export interface Prescription {
  id: string;
  prescription_code: string;
  consultation_id: string;
  patient_id: string;
  patient_name?: string;
  patient_hospital_number?: string;
  doctor_id: string;
  doctor_name?: string;
  status: PrescriptionStatus;
  pharmacist_notes: string | null;
  items: PrescriptionItem[];
  dispensing_records?: PharmacyDispensing[];
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  recipient_user_id: string | null;
  recipient_role: UserRole | null;
  title: string;
  message: string;
  category: string;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: string;
  hospital_name: string;
  institution_name: string;
  clinic_hours: string;
  max_daily_appointments: number;
  allow_patient_cancellations: boolean;
  appointment_slot_minutes: number;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  gender: 'Male' | 'Female' | 'Other' | null;
  date_of_birth: string | null;
  address: string | null;
  role: UserRole;
  is_active: boolean;
  patient?: PatientRecord | null;
  doctor?: DoctorRecord | null;
}

export interface StaffAccountSummary {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  department_id?: string | null;
  department_name?: string | null;
  specialization?: string | null;
  staff_code?: string | null;
  consultation_room?: string | null;
  created_at: string;
}

export interface MatricVerificationResult {
  ok: boolean;
  code: 'VERIFIED' | 'NOT_FOUND' | 'ALREADY_REGISTERED' | 'INVALID_FORMAT';
  message?: string;
  full_name?: string;
  matric_number?: string;
  department?: string;
}

