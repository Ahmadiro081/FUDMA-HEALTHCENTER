-- =============================================================================
-- FUDMA HEALTHCENTER: PostgreSQL Schema Migration (001_schema.sql)
-- Target: Supabase (PostgreSQL 15+) Free Tier Compatible
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom Enum-like Check Constraints ensure strict data integrity
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
  date_of_birth DATE,
  address TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('patient', 'nurse', 'lab', 'pharmacy', 'doctor', 'admin')),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  hospital_number TEXT NOT NULL UNIQUE,
  matric_or_staff_id TEXT,
  patient_category TEXT NOT NULL DEFAULT 'Student' CHECK (patient_category IN ('Student', 'Staff', 'Dependent', 'Community')),
  faculty_or_unit TEXT,
  blood_group TEXT CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown')),
  genotype TEXT CHECK (genotype IN ('AA', 'AS', 'SS', 'AC', 'SC', 'Unknown')),
  allergies TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  staff_code TEXT NOT NULL UNIQUE,
  specialization TEXT NOT NULL,
  license_number TEXT,
  consultation_room TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_code TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  consultation_category TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Booked' CHECK (
    status IN ('Booked', 'Approved', 'Checked In', 'Waiting', 'In Consultation', 'Completed', 'Cancelled', 'Rescheduled')
  ),
  queue_number INTEGER,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  temperature_c NUMERIC(4,1),
  blood_pressure TEXT,
  pulse_bpm INTEGER,
  respiratory_rate INTEGER,
  spo2_percent INTEGER,
  weight_kg NUMERIC(5,2),
  height_cm NUMERIC(5,2),
  triage_notes TEXT,
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Urgent', 'Emergency')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  chief_complaint TEXT NOT NULL,
  clinical_observations TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  treatment_plan TEXT,
  follow_up_date DATE,
  follow_up_notes TEXT,
  status TEXT NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Awaiting Lab', 'Completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.laboratory_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code TEXT NOT NULL UNIQUE,
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  test_name TEXT NOT NULL,
  test_category TEXT NOT NULL,
  clinical_notes TEXT,
  urgency TEXT NOT NULL DEFAULT 'Routine' CHECK (urgency IN ('Routine', 'Urgent', 'Stat')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Sample Collected', 'Processing', 'Completed', 'Reviewed')),
  assigned_lab_staff UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.laboratory_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_request_id UUID NOT NULL UNIQUE REFERENCES public.laboratory_requests(id) ON DELETE CASCADE,
  recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  findings TEXT NOT NULL,
  numeric_value TEXT,
  reference_range TEXT,
  interpretation TEXT NOT NULL DEFAULT 'Normal' CHECK (interpretation IN ('Normal', 'Abnormal', 'Critical')),
  scientist_remarks TEXT,
  reviewed_by_doctor BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  generic_name TEXT NOT NULL,
  category TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 20 CHECK (reorder_level >= 0),
  unit_label TEXT NOT NULL DEFAULT 'Packs',
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_code TEXT NOT NULL UNIQUE,
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    status IN ('Pending', 'Available', 'Partially Dispensed', 'Dispensed', 'Unavailable')
  ),
  pharmacist_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
  medication_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  quantity_prescribed INTEGER NOT NULL CHECK (quantity_prescribed > 0),
  quantity_dispensed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_dispensed >= 0),
  availability_status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    availability_status IN ('Pending', 'Available', 'Dispensed', 'Unavailable')
  ),
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_dispensing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  dispensed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  dispensed_notes TEXT,
  dispensed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_role TEXT CHECK (recipient_role IN ('patient', 'nurse', 'lab', 'pharmacy', 'doctor', 'admin')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT NOT NULL DEFAULT 'FUDMA HEALTHCENTER',
  institution_name TEXT NOT NULL DEFAULT 'Federal University Dutsin-Ma',
  clinic_hours TEXT NOT NULL DEFAULT '08:00 - 18:00 (24/7 Emergency Triage)',
  max_daily_appointments INTEGER NOT NULL DEFAULT 120,
  allow_patient_cancellations BOOLEAN NOT NULL DEFAULT TRUE,
  appointment_slot_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for core clinical query paths and foreign keys
CREATE INDEX IF NOT EXISTS idx_patients_hospital_number ON public.patients(hospital_number);
CREATE INDEX IF NOT EXISTS idx_patients_matric_staff_id ON public.patients(matric_or_staff_id);
CREATE INDEX IF NOT EXISTS idx_doctors_department ON public.doctors(department_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON public.appointments(patient_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status_date ON public.appointments(status, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON public.appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_department ON public.appointments(department_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON public.patient_vitals(patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_appointment ON public.patient_vitals(appointment_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient ON public.consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON public.consultations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON public.laboratory_requests(status);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient ON public.laboratory_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_consultation ON public.laboratory_requests(consultation_id);
CREATE INDEX IF NOT EXISTS idx_medications_category ON public.medications(category);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON public.prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation ON public.prescriptions(consultation_id);
CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription ON public.prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);

-- Automatic updated_at trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'profiles', 'user_roles', 'departments', 'patients', 'doctors',
    'appointments', 'patient_vitals', 'consultations', 'laboratory_requests',
    'laboratory_results', 'medications', 'prescriptions', 'prescription_items',
    'pharmacy_dispensing', 'notifications', 'activity_logs', 'system_settings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      tbl, tbl
    );
  END LOOP;
END $$;
