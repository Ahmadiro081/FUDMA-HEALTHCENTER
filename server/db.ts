import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLog,
  AppNotification,
  Appointment,
  Consultation,
  Department,
  DoctorRecord,
  LaboratoryRequest,
  LaboratoryResult,
  Medication,
  PatientRecord,
  PatientVital,
  PharmacyDispensing,
  Prescription,
  PrescriptionItem,
  Profile,
  SystemSettings,
  UserRole,
} from '../src/types/hospital.ts';

export interface StoredUser extends Profile {
  password_hash: string;
  role: UserRole;
}

export interface StoredDoctor {
  id: string;
  profile_id: string;
  department_id: string;
  staff_code: string;
  specialization: string;
  license_number: string | null;
  consultation_room: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoredPatient {
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

export interface StoredPrescription {
  id: string;
  prescription_code: string;
  consultation_id: string;
  patient_id: string;
  doctor_id: string;
  status: Prescription['status'];
  pharmacist_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Group11WhitelistEntry {
  id: string;
  full_name: string;
  matric_number: string;
  department: string;
  is_registered: boolean;
  registered_user_id: string | null;
  created_at: string;
  registered_at: string | null;
}

export interface DatabaseState {
  users: StoredUser[];
  departments: Department[];
  patients: StoredPatient[];
  doctors: StoredDoctor[];
  appointments: Appointment[];
  vitals: PatientVital[];
  consultations: Consultation[];
  laboratory_requests: LaboratoryRequest[];
  laboratory_results: LaboratoryResult[];
  medications: Medication[];
  prescriptions: StoredPrescription[];
  prescription_items: PrescriptionItem[];
  pharmacy_dispensing: PharmacyDispensing[];
  notifications: AppNotification[];
  activity_logs: ActivityLog[];
  system_settings: SystemSettings;
  group11_student_whitelist: Group11WhitelistEntry[];
}

export function normalizeMatricNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function createGroup11WhitelistSeed(now = isoNow()): Group11WhitelistEntry[] {
  return [
    {
      id: 'g11-0001-0000-4000-8000-000000000001',
      full_name: 'SALISU ABUBAKAR BAKORI',
      matric_number: 'ENG/2024/32094',
      department: 'Civil Engineering',
      is_registered: false,
      registered_user_id: null,
      created_at: now,
      registered_at: null,
    },
    {
      id: 'g11-0002-0000-4000-8000-000000000002',
      full_name: 'ABDULHAKEEM FARUK OLANIYI',
      matric_number: 'ENG/2024/31802',
      department: 'Mechanical Engineering',
      is_registered: false,
      registered_user_id: null,
      created_at: now,
      registered_at: null,
    },
    {
      id: 'g11-0003-0000-4000-8000-000000000003',
      full_name: 'ALI EZEKIEL ENEOJO',
      matric_number: 'ENG/2024/31820',
      department: 'Civil Engineering',
      is_registered: false,
      registered_user_id: null,
      created_at: now,
      registered_at: null,
    },
    {
      id: 'g11-0004-0000-4000-8000-000000000004',
      full_name: 'MUHAMMAD RAJI ABDULMUHAIMIN',
      matric_number: 'ENG/2024/31747',
      department: 'Mechatronics Engineering',
      is_registered: false,
      registered_user_id: null,
      created_at: now,
      registered_at: null,
    },
    {
      id: 'g11-0005-0000-4000-8000-000000000005',
      full_name: 'MOHAMMED MANDAJUMA IBRAHIM',
      matric_number: 'ENG/2024/31911',
      department: 'Mechanical Engineering',
      is_registered: false,
      registered_user_id: null,
      created_at: now,
      registered_at: null,
    },
  ];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'fudma_healthcenter.json');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function isoNow(): string {
  return new Date().toISOString();
}

function todayDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export const DEMO_USER_IDS = new Set([
  'u1000000-0000-4000-8000-000000000001',
  'u1000000-0000-4000-8000-000000000002',
  'u1000000-0000-4000-8000-000000000003',
  'u1000000-0000-4000-8000-000000000004',
  'u1000000-0000-4000-8000-000000000005',
  'u1000000-0000-4000-8000-000000000006',
  'u1000000-0000-4000-8000-000000000007',
  'u1000000-0000-4000-8000-000000000008',
]);

function createInitialSeed(): DatabaseState {
  const now = isoNow();
  const isProd = process.env.NODE_ENV === 'production';
  const today = todayDateStr(0);
  const tomorrow = todayDateStr(1);
  const yesterday = todayDateStr(-1);

  const deptGopdId = 'd1000000-0000-4000-8000-000000000001';
  const deptNursId = 'd1000000-0000-4000-8000-000000000002';
  const deptLabsId = 'd1000000-0000-4000-8000-000000000003';
  const deptPharId = 'd1000000-0000-4000-8000-000000000004';
  const deptMwpcId = 'd1000000-0000-4000-8000-000000000005';

  const departments: Department[] = [
    {
      id: deptGopdId,
      name: 'General Outpatient & Family Medicine',
      code: 'GOPD',
      description: 'Primary university healthcare, acute illness consultation, and general medical reviews.',
      location: 'Ground Floor, Block A',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: deptNursId,
      name: 'Nursing & Triage Station',
      code: 'NURS',
      description: 'Patient arrival verification, vital signs assessment, and clinical queue allocation.',
      location: 'Main Reception Hall',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: deptLabsId,
      name: 'Medical Laboratory Services',
      code: 'LABS',
      description: 'Hematology, malaria parasitology, clinical chemistry, and microbiology diagnostics.',
      location: 'Wing B, Diagnostics',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: deptPharId,
      name: 'Hospital Pharmacy & Dispensary',
      code: 'PHAR',
      description: 'Prescription verification, medication dispensing, and inventory control.',
      location: 'Ground Floor, Wing C',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: deptMwpcId,
      name: 'Preventive & Student Wellness Clinic',
      code: 'MWPC',
      description: 'Campus health screenings, immunizations, and routine chronic care follow-ups.',
      location: 'First Floor, Block A',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const system_settings: SystemSettings = {
    id: 'set10000-0000-4000-8000-000000000001',
    hospital_name: 'FUDMA HEALTHCENTER',
    institution_name: 'Federal University Dutsin-Ma',
    clinic_hours: '08:00 - 18:00 (24/7 Emergency Triage)',
    max_daily_appointments: 120,
    allow_patient_cancellations: true,
    appointment_slot_minutes: 30,
    updated_at: now,
  };

  if (isProd) {
    const prodUsers: StoredUser[] = [];
    const initAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const initAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (initAdminEmail && initAdminPassword && initAdminPassword.length >= 12) {
      prodUsers.push({
        id: crypto.randomUUID(),
        full_name: process.env.INITIAL_ADMIN_NAME?.trim() || 'System Administrator',
        email: initAdminEmail,
        phone: null,
        gender: null,
        date_of_birth: null,
        address: 'FUDMA Healthcenter Administration',
        is_active: true,
        role: 'admin',
        password_hash: hashPassword(initAdminPassword),
        created_at: now,
        updated_at: now,
      });
    }
    return {
      users: prodUsers,
      departments,
      patients: [],
      doctors: [],
      appointments: [],
      vitals: [],
      consultations: [],
      laboratory_requests: [],
      laboratory_results: [],
      medications: [],
      prescriptions: [],
      prescription_items: [],
      pharmacy_dispensing: [],
      notifications: [],
      activity_logs: [],
      system_settings,
      group11_student_whitelist: createGroup11WhitelistSeed(now),
    };
  }

  const defaultPassHash = hashPassword('Fudma@2026');

  const uAdminId = 'u1000000-0000-4000-8000-000000000001';
  const uDoc1Id = 'u1000000-0000-4000-8000-000000000002';
  const uDoc2Id = 'u1000000-0000-4000-8000-000000000003';
  const uNurseId = 'u1000000-0000-4000-8000-000000000004';
  const uLabId = 'u1000000-0000-4000-8000-000000000005';
  const uPharmId = 'u1000000-0000-4000-8000-000000000006';
  const uPat1Id = 'u1000000-0000-4000-8000-000000000007';
  const uPat2Id = 'u1000000-0000-4000-8000-000000000008';

  const users: StoredUser[] = [
    {
      id: uAdminId,
      full_name: 'Alh. Ibrahim Dikko',
      email: 'admin@fudma.edu.ng',
      phone: '+234 803 410 1100',
      gender: 'Male',
      date_of_birth: '1978-04-12',
      address: 'FUDMA Healthcenter Admin Wing, Dutsin-Ma',
      is_active: true,
      role: 'admin',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uDoc1Id,
      full_name: 'Dr. Amina Bello-Sani',
      email: 'doctor@fudma.edu.ng',
      phone: '+234 806 221 4401',
      gender: 'Female',
      date_of_birth: '1984-09-18',
      address: 'Senior Staff Quarters, FUDMA Take-Off Site',
      is_active: true,
      role: 'doctor',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uDoc2Id,
      full_name: 'Dr. Musa Abdullahi',
      email: 'dr.musa@fudma.edu.ng',
      phone: '+234 805 712 8890',
      gender: 'Male',
      date_of_birth: '1981-02-07',
      address: 'Katsina Road Quarters, Dutsin-Ma',
      is_active: true,
      role: 'doctor',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uNurseId,
      full_name: 'Nurse Zainab Lawal',
      email: 'nurse@fudma.edu.ng',
      phone: '+234 803 998 3104',
      gender: 'Female',
      date_of_birth: '1989-11-23',
      address: 'Dutsin-Ma Township',
      is_active: true,
      role: 'nurse',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uLabId,
      full_name: 'MLS Yusuf Garba',
      email: 'lab@fudma.edu.ng',
      phone: '+234 802 554 7721',
      gender: 'Male',
      date_of_birth: '1987-06-15',
      address: 'Darawa Layout, Dutsin-Ma',
      is_active: true,
      role: 'lab',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uPharmId,
      full_name: 'Pharm. Fatima Kabir',
      email: 'pharmacy@fudma.edu.ng',
      phone: '+234 809 332 6180',
      gender: 'Female',
      date_of_birth: '1990-01-30',
      address: 'Hospital Road, Dutsin-Ma',
      is_active: true,
      role: 'pharmacy',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uPat1Id,
      full_name: 'Abubakar Sadiq Umar',
      email: 'patient@fudma.edu.ng',
      phone: '+234 814 602 9912',
      gender: 'Male',
      date_of_birth: '2003-05-14',
      address: 'Male Hostel Block C, Room 14, FUDMA Main Campus',
      is_active: true,
      role: 'patient',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
    {
      id: uPat2Id,
      full_name: 'Hauwa Aliyu Danjuma',
      email: 'hauwa.aliyu@fudma.edu.ng',
      phone: '+234 816 204 5109',
      gender: 'Female',
      date_of_birth: '2004-08-21',
      address: 'Female Hostel Block B, Room 08, FUDMA Main Campus',
      is_active: true,
      role: 'patient',
      password_hash: defaultPassHash,
      created_at: now,
      updated_at: now,
    },
  ];

  const doc1Id = 'doc10000-0000-4000-8000-000000000001';
  const doc2Id = 'doc10000-0000-4000-8000-000000000002';

  const doctors: StoredDoctor[] = [
    {
      id: doc1Id,
      profile_id: uDoc1Id,
      department_id: deptGopdId,
      staff_code: 'FUDMA-MD-001',
      specialization: 'Family & General Medicine',
      license_number: 'MDCN/R/44812',
      consultation_room: 'Consult Room 1',
      is_available: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: doc2Id,
      profile_id: uDoc2Id,
      department_id: deptMwpcId,
      staff_code: 'FUDMA-MD-002',
      specialization: 'Internal Medicine & Wellness',
      license_number: 'MDCN/R/39105',
      consultation_room: 'Consult Room 2',
      is_available: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const pat1Id = 'pat10000-0000-4000-8000-000000000001';
  const pat2Id = 'pat10000-0000-4000-8000-000000000002';
  const pat3Id = 'pat10000-0000-4000-8000-000000000003';

  const patients: StoredPatient[] = [
    {
      id: pat1Id,
      profile_id: uPat1Id,
      hospital_number: 'FUDMA-HC-24-0101',
      matric_or_staff_id: 'CSC/2022/0184',
      patient_category: 'Student',
      faculty_or_unit: 'Faculty of Computing',
      blood_group: 'O+',
      genotype: 'AA',
      allergies: 'None known',
      emergency_contact_name: 'Umar Farouk',
      emergency_contact_phone: '+234 803 111 2244',
      is_walk_in: false,
      full_name: 'Abubakar Sadiq Umar',
      email: 'patient@fudma.edu.ng',
      phone: '+234 814 602 9912',
      gender: 'Male',
      date_of_birth: '2003-05-14',
      address: 'Male Hostel Block C, Room 14, FUDMA Main Campus',
      created_at: now,
      updated_at: now,
    },
    {
      id: pat2Id,
      profile_id: uPat2Id,
      hospital_number: 'FUDMA-HC-24-0102',
      matric_or_staff_id: 'BIO/2023/0042',
      patient_category: 'Student',
      faculty_or_unit: 'Faculty of Life Sciences',
      blood_group: 'A+',
      genotype: 'AS',
      allergies: 'Sulfonamides',
      emergency_contact_name: 'Aliyu Danjuma',
      emergency_contact_phone: '+234 802 445 8871',
      is_walk_in: false,
      full_name: 'Hauwa Aliyu Danjuma',
      email: 'hauwa.aliyu@fudma.edu.ng',
      phone: '+234 816 204 5109',
      gender: 'Female',
      date_of_birth: '2004-08-21',
      address: 'Female Hostel Block B, Room 08, FUDMA Main Campus',
      created_at: now,
      updated_at: now,
    },
    {
      id: pat3Id,
      profile_id: null,
      hospital_number: 'FUDMA-HC-24-0103',
      matric_or_staff_id: 'FUDMA/STF/0892',
      patient_category: 'Staff',
      faculty_or_unit: 'Registry & Academic Affairs',
      blood_group: 'B+',
      genotype: 'AA',
      allergies: 'Penicillin mild rash',
      emergency_contact_name: 'Maryam Sani',
      emergency_contact_phone: '+234 805 667 9031',
      is_walk_in: true,
      full_name: 'Sani Mohammed Kankia',
      email: 'sani.kankia@fudma.edu.ng',
      phone: '+234 803 771 4208',
      gender: 'Male',
      date_of_birth: '1979-12-03',
      address: 'Senior Staff Quarters, Dutsin-Ma',
      created_at: now,
      updated_at: now,
    },
  ];

  const appt1Id = 'app10000-0000-4000-8000-000000000001';
  const appt2Id = 'app10000-0000-4000-8000-000000000002';
  const appt3Id = 'app10000-0000-4000-8000-000000000003';
  const appt4Id = 'app10000-0000-4000-8000-000000000004';

  const appointments: Appointment[] = [
    {
      id: appt1Id,
      appointment_code: 'APT-2026-1001',
      patient_id: pat1Id,
      department_id: deptGopdId,
      doctor_id: doc1Id,
      consultation_category: 'General Consultation',
      appointment_date: yesterday,
      appointment_time: '09:30',
      reason: 'Persistent fever, headache, and generalized body weakness for 2 days.',
      status: 'Completed',
      queue_number: 1,
      checked_in_at: now,
      checked_in_by: uNurseId,
      notes: 'Seen and discharged with prescription.',
      created_at: now,
      updated_at: now,
    },
    {
      id: appt2Id,
      appointment_code: 'APT-2026-1002',
      patient_id: pat2Id,
      department_id: deptGopdId,
      doctor_id: doc1Id,
      consultation_category: 'General Consultation',
      appointment_date: today,
      appointment_time: '10:00',
      reason: 'Sore throat, dry cough, and mild evening chills.',
      status: 'Waiting',
      queue_number: 2,
      checked_in_at: now,
      checked_in_by: uNurseId,
      notes: 'Vitals logged at Nursing Station; queued for Consult Room 1.',
      created_at: now,
      updated_at: now,
    },
    {
      id: appt3Id,
      appointment_code: 'APT-2026-1003',
      patient_id: pat3Id,
      department_id: deptMwpcId,
      doctor_id: doc2Id,
      consultation_category: 'Hypertension & Chronic Review',
      appointment_date: today,
      appointment_time: '11:00',
      reason: 'Monthly blood pressure monitoring and medication refill review.',
      status: 'In Consultation',
      queue_number: 3,
      checked_in_at: now,
      checked_in_by: uNurseId,
      notes: 'Patient currently in Consult Room 2.',
      created_at: now,
      updated_at: now,
    },
    {
      id: appt4Id,
      appointment_code: 'APT-2026-1004',
      patient_id: pat1Id,
      department_id: deptMwpcId,
      doctor_id: null,
      consultation_category: 'Student Wellness & Medical Screening',
      appointment_date: tomorrow,
      appointment_time: '09:00',
      reason: 'Follow-up post-malaria recovery review and fitness clearance.',
      status: 'Booked',
      queue_number: null,
      checked_in_at: null,
      checked_in_by: null,
      notes: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const vitals: PatientVital[] = [
    {
      id: 'vit10000-0000-4000-8000-000000000001',
      appointment_id: appt1Id,
      patient_id: pat1Id,
      recorded_by: uNurseId,
      temperature_c: 38.4,
      blood_pressure: '118/76',
      pulse_bpm: 94,
      respiratory_rate: 20,
      spo2_percent: 98,
      weight_kg: 66.5,
      height_cm: 174,
      triage_notes: 'Febrile on arrival; hydrated verbally.',
      priority: 'Urgent',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'vit10000-0000-4000-8000-000000000002',
      appointment_id: appt2Id,
      patient_id: pat2Id,
      recorded_by: uNurseId,
      temperature_c: 37.5,
      blood_pressure: '112/72',
      pulse_bpm: 86,
      respiratory_rate: 18,
      spo2_percent: 99,
      weight_kg: 58.2,
      height_cm: 164,
      triage_notes: 'Alert and oriented; mild pharyngeal discomfort noted.',
      priority: 'Normal',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'vit10000-0000-4000-8000-000000000003',
      appointment_id: appt3Id,
      patient_id: pat3Id,
      recorded_by: uNurseId,
      temperature_c: 36.7,
      blood_pressure: '138/88',
      pulse_bpm: 78,
      respiratory_rate: 16,
      spo2_percent: 98,
      weight_kg: 79.0,
      height_cm: 176,
      triage_notes: 'Routine BP check prior to physician review.',
      priority: 'Normal',
      created_at: now,
      updated_at: now,
    },
  ];

  const con1Id = 'con10000-0000-4000-8000-000000000001';
  const con2Id = 'con10000-0000-4000-8000-000000000002';

  const consultations: Consultation[] = [
    {
      id: con1Id,
      appointment_id: appt1Id,
      patient_id: pat1Id,
      doctor_id: doc1Id,
      chief_complaint: '2-day history of intermittent fever and frontal headache.',
      clinical_observations: 'Mildly febrile (38.4°C), anicteric, chest clear bilaterally, soft abdomen.',
      diagnosis: 'Uncomplicated Malaria (Confirmed)',
      treatment_plan: 'Complete 3-day Artemether/Lumefantrine course, oral hydration, antipyretic PRN.',
      follow_up_date: tomorrow,
      follow_up_notes: 'Return to Wellness Clinic if fever persists beyond 48 hours.',
      status: 'Completed',
      created_at: now,
      updated_at: now,
    },
    {
      id: con2Id,
      appointment_id: appt3Id,
      patient_id: pat3Id,
      doctor_id: doc2Id,
      chief_complaint: 'Scheduled hypertension review and fasting lipid screening.',
      clinical_observations: 'BP 138/88 mmHg, regular heart sounds S1/S2, no pedal edema.',
      diagnosis: 'Essential Hypertension (Controlled)',
      treatment_plan: 'Continue Amlodipine 5mg OD; await fasting blood sugar & lipid panel.',
      follow_up_date: todayDateStr(30),
      follow_up_notes: 'Review lab results once submitted by Medical Laboratory.',
      status: 'Awaiting Lab',
      created_at: now,
      updated_at: now,
    },
  ];

  const labReq1Id = 'lab10000-0000-4000-8000-000000000001';
  const labReq2Id = 'lab10000-0000-4000-8000-000000000002';

  const laboratory_requests: LaboratoryRequest[] = [
    {
      id: labReq1Id,
      request_code: 'LAB-2026-0401',
      consultation_id: con1Id,
      patient_id: pat1Id,
      doctor_id: doc1Id,
      test_name: 'Malaria Parasite (MP) & PCV',
      test_category: 'Hematology / Parasitology',
      clinical_notes: 'Rule out Plasmodium falciparum parasitemia.',
      urgency: 'Urgent',
      status: 'Reviewed',
      assigned_lab_staff: uLabId,
      created_at: now,
      updated_at: now,
    },
    {
      id: labReq2Id,
      request_code: 'LAB-2026-0402',
      consultation_id: con2Id,
      patient_id: pat3Id,
      doctor_id: doc2Id,
      test_name: 'Fasting Blood Glucose & Lipid Profile',
      test_category: 'Clinical Chemistry',
      clinical_notes: 'Routine quarterly metabolic check for hypertensive staff patient.',
      urgency: 'Routine',
      status: 'Pending',
      assigned_lab_staff: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const laboratory_results: LaboratoryResult[] = [
    {
      id: 'res10000-0000-4000-8000-000000000001',
      lab_request_id: labReq1Id,
      recorded_by: uLabId,
      findings: 'Malaria Parasite: Positive (++) Plasmodium falciparum. PCV: 41%.',
      numeric_value: 'PCV 41% / MP ++',
      reference_range: 'PCV 38–50% / MP Negative',
      interpretation: 'Abnormal',
      scientist_remarks: 'Thick and thin blood film examined under 100x oil immersion.',
      reviewed_by_doctor: true,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
  ];

  const med1Id = 'med10000-0000-4000-8000-000000000001';
  const med2Id = 'med10000-0000-4000-8000-000000000002';
  const med3Id = 'med10000-0000-4000-8000-000000000003';
  const med4Id = 'med10000-0000-4000-8000-000000000004';
  const med5Id = 'med10000-0000-4000-8000-000000000005';
  const med6Id = 'med10000-0000-4000-8000-000000000006';
  const med7Id = 'med10000-0000-4000-8000-000000000007';
  const med8Id = 'med10000-0000-4000-8000-000000000008';

  const medications: Medication[] = [
    {
      id: med1Id,
      sku: 'MED-001',
      name: 'Coartem 80/480mg',
      generic_name: 'Artemether / Lumefantrine',
      category: 'Antimalarial',
      dosage_form: 'Tablet',
      strength: '80mg / 480mg',
      stock_quantity: 145,
      reorder_level: 30,
      unit_label: 'Courses',
      expiry_date: '2027-08-30',
      created_at: now,
      updated_at: now,
    },
    {
      id: med2Id,
      sku: 'MED-002',
      name: 'Amoxil 500mg',
      generic_name: 'Amoxicillin',
      category: 'Antibiotic',
      dosage_form: 'Capsule',
      strength: '500mg',
      stock_quantity: 210,
      reorder_level: 40,
      unit_label: 'Packs',
      expiry_date: '2027-11-15',
      created_at: now,
      updated_at: now,
    },
    {
      id: med3Id,
      sku: 'MED-003',
      name: 'Emzor Paracetamol 500mg',
      generic_name: 'Acetaminophen',
      category: 'Analgesic',
      dosage_form: 'Tablet',
      strength: '500mg',
      stock_quantity: 480,
      reorder_level: 80,
      unit_label: 'Blister Packs',
      expiry_date: '2028-02-20',
      created_at: now,
      updated_at: now,
    },
    {
      id: med4Id,
      sku: 'MED-004',
      name: 'Augmentin 625mg',
      generic_name: 'Amoxicillin / Clavulanate',
      category: 'Antibiotic',
      dosage_form: 'Tablet',
      strength: '625mg',
      stock_quantity: 12,
      reorder_level: 25,
      unit_label: 'Packs',
      expiry_date: '2027-06-10',
      created_at: now,
      updated_at: now,
    },
    {
      id: med5Id,
      sku: 'MED-005',
      name: 'Amlodipine 5mg',
      generic_name: 'Amlodipine Besylate',
      category: 'Antihypertensive',
      dosage_form: 'Tablet',
      strength: '5mg',
      stock_quantity: 88,
      reorder_level: 25,
      unit_label: 'Packs',
      expiry_date: '2027-10-14',
      created_at: now,
      updated_at: now,
    },
    {
      id: med6Id,
      sku: 'MED-006',
      name: 'Omeprazole 20mg',
      generic_name: 'Omeprazole',
      category: 'Gastrointestinal',
      dosage_form: 'Capsule',
      strength: '20mg',
      stock_quantity: 120,
      reorder_level: 30,
      unit_label: 'Packs',
      expiry_date: '2027-12-01',
      created_at: now,
      updated_at: now,
    },
    {
      id: med7Id,
      sku: 'MED-007',
      name: 'Loratadine 10mg',
      generic_name: 'Loratadine',
      category: 'Antihistamine',
      dosage_form: 'Tablet',
      strength: '10mg',
      stock_quantity: 14,
      reorder_level: 20,
      unit_label: 'Packs',
      expiry_date: '2027-05-25',
      created_at: now,
      updated_at: now,
    },
    {
      id: med8Id,
      sku: 'MED-008',
      name: 'Oral Rehydration Salts (ORS)',
      generic_name: 'Glucose / Electrolytes',
      category: 'Rehydration',
      dosage_form: 'Sachet',
      strength: '20.5g',
      stock_quantity: 310,
      reorder_level: 60,
      unit_label: 'Sachets',
      expiry_date: '2028-04-18',
      created_at: now,
      updated_at: now,
    },
  ];

  const rx1Id = 'rx100000-0000-4000-8000-000000000001';
  const rx2Id = 'rx100000-0000-4000-8000-000000000002';

  const prescriptions: StoredPrescription[] = [
    {
      id: rx1Id,
      prescription_code: 'RX-2026-0801',
      consultation_id: con1Id,
      patient_id: pat1Id,
      doctor_id: doc1Id,
      status: 'Dispensed',
      pharmacist_notes: 'Counseled student on taking Coartem with a light meal.',
      created_at: now,
      updated_at: now,
    },
    {
      id: rx2Id,
      prescription_code: 'RX-2026-0802',
      consultation_id: con2Id,
      patient_id: pat3Id,
      doctor_id: doc2Id,
      status: 'Pending',
      pharmacist_notes: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const prescription_items: PrescriptionItem[] = [
    {
      id: 'rxi10000-0000-4000-8000-000000000001',
      prescription_id: rx1Id,
      medication_id: med1Id,
      medication_name: 'Coartem 80/480mg',
      dosage: '1 tablet',
      frequency: 'Twice daily (BD)',
      duration: '3 days',
      quantity_prescribed: 1,
      quantity_dispensed: 1,
      availability_status: 'Dispensed',
      instructions: 'Take after meals.',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'rxi10000-0000-4000-8000-000000000002',
      prescription_id: rx1Id,
      medication_id: med3Id,
      medication_name: 'Emzor Paracetamol 500mg',
      dosage: '1000mg (2 tabs)',
      frequency: 'Every 8 hours PRN',
      duration: '3 days',
      quantity_prescribed: 2,
      quantity_dispensed: 2,
      availability_status: 'Dispensed',
      instructions: 'For fever or headache.',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'rxi10000-0000-4000-8000-000000000003',
      prescription_id: rx2Id,
      medication_id: med5Id,
      medication_name: 'Amlodipine 5mg',
      dosage: '5mg (1 tab)',
      frequency: 'Once daily (OD)',
      duration: '30 days',
      quantity_prescribed: 3,
      quantity_dispensed: 0,
      availability_status: 'Pending',
      instructions: 'Take every morning.',
      created_at: now,
      updated_at: now,
    },
  ];

  const pharmacy_dispensing: PharmacyDispensing[] = [
    {
      id: 'dsp10000-0000-4000-8000-000000000001',
      prescription_id: rx1Id,
      dispensed_by: uPharmId,
      dispensed_by_name: 'Pharm. Fatima Kabir',
      dispensed_notes: 'Full 3-day antimalarial course and paracetamol dispensed.',
      dispensed_at: now,
      created_at: now,
    },
  ];

  const notifications: AppNotification[] = [
    {
      id: 'not10000-0000-4000-8000-000000000001',
      recipient_user_id: uPat1Id,
      recipient_role: null,
      title: 'Laboratory Results Reviewed',
      message: 'Your Malaria Parasite & PCV results for APT-2026-1001 have been reviewed by Dr. Amina Bello-Sani.',
      category: 'laboratory',
      reference_id: labReq1Id,
      is_read: false,
      created_at: now,
    },
    {
      id: 'not10000-0000-4000-8000-000000000002',
      recipient_user_id: uPat1Id,
      recipient_role: null,
      title: 'Appointment Scheduled',
      message: 'Your follow-up wellness appointment APT-2026-1004 is booked for tomorrow at 09:00.',
      category: 'appointment',
      reference_id: appt4Id,
      is_read: false,
      created_at: now,
    },
    {
      id: 'not10000-0000-4000-8000-000000000003',
      recipient_user_id: null,
      recipient_role: 'lab',
      title: 'New Laboratory Request',
      message: 'Fasting Blood Glucose & Lipid Profile requested for Sani Mohammed Kankia (LAB-2026-0402).',
      category: 'laboratory',
      reference_id: labReq2Id,
      is_read: false,
      created_at: now,
    },
    {
      id: 'not10000-0000-4000-8000-000000000004',
      recipient_user_id: null,
      recipient_role: 'pharmacy',
      title: 'Pending Prescription Queue',
      message: 'Prescription RX-2026-0802 for Sani Mohammed Kankia is awaiting verification and dispensing.',
      category: 'pharmacy',
      reference_id: rx2Id,
      is_read: false,
      created_at: now,
    },
  ];

  const activity_logs: ActivityLog[] = [
    {
      id: 'log10000-0000-4000-8000-000000000001',
      actor_id: uNurseId,
      actor_name: 'Nurse Zainab Lawal',
      actor_role: 'nurse',
      action: 'PATIENT_CHECK_IN',
      entity_type: 'appointment',
      entity_id: 'APT-2026-1002',
      details: 'Checked in Hauwa Aliyu Danjuma and recorded triage vitals.',
      created_at: now,
    },
    {
      id: 'log10000-0000-4000-8000-000000000002',
      actor_id: uLabId,
      actor_name: 'MLS Yusuf Garba',
      actor_role: 'lab',
      action: 'LAB_RESULT_SUBMITTED',
      entity_type: 'laboratory_request',
      entity_id: 'LAB-2026-0401',
      details: 'Submitted Malaria Parasite & PCV results for Abubakar Sadiq Umar.',
      created_at: now,
    },
    {
      id: 'log10000-0000-4000-8000-000000000003',
      actor_id: uPharmId,
      actor_name: 'Pharm. Fatima Kabir',
      actor_role: 'pharmacy',
      action: 'PRESCRIPTION_DISPENSED',
      entity_type: 'prescription',
      entity_id: 'RX-2026-0801',
      details: 'Dispensed Coartem 80/480mg and Emzor Paracetamol 500mg.',
      created_at: now,
    },
  ];

  return {
    users,
    departments,
    patients,
    doctors,
    appointments,
    vitals,
    consultations,
    laboratory_requests,
    laboratory_results,
    medications,
    prescriptions,
    prescription_items,
    pharmacy_dispensing,
    notifications,
    activity_logs,
    system_settings,
    group11_student_whitelist: createGroup11WhitelistSeed(now),
  };
}

let cachedState: DatabaseState | null = null;

export function loadDb(): DatabaseState {
  if (cachedState) return cachedState;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    cachedState = createInitialSeed();
    saveDb(cachedState);
    return cachedState;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseState;
    if (!Array.isArray(parsed.group11_student_whitelist)) {
      parsed.group11_student_whitelist = createGroup11WhitelistSeed();
      cachedState = parsed;
      saveDb(cachedState);
      return cachedState;
    }
    cachedState = parsed;
    return cachedState;
  } catch {
    cachedState = createInitialSeed();
    saveDb(cachedState);
    return cachedState;
  }
}

export function saveDb(state: DatabaseState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
  cachedState = state;
}

export function enrichDoctor(db: DatabaseState, doc: StoredDoctor): DoctorRecord {
  const user = db.users.find((u) => u.id === doc.profile_id);
  const dept = db.departments.find((d) => d.id === doc.department_id);
  return {
    id: doc.id,
    profile_id: doc.profile_id,
    department_id: doc.department_id,
    department_name: dept?.name || 'General Outpatient',
    staff_code: doc.staff_code,
    specialization: doc.specialization,
    license_number: doc.license_number,
    consultation_room: doc.consultation_room,
    is_available: doc.is_available,
    full_name: user?.full_name || 'Medical Officer',
    email: user?.email || '',
    phone: user?.phone || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export function enrichPatient(db: DatabaseState, pat: StoredPatient): PatientRecord {
  const user = pat.profile_id ? db.users.find((u) => u.id === pat.profile_id) : null;
  return {
    ...pat,
    full_name: user?.full_name || pat.full_name,
    email: user?.email || pat.email,
    phone: user?.phone || pat.phone,
    gender: user?.gender || pat.gender,
    date_of_birth: user?.date_of_birth || pat.date_of_birth,
    address: user?.address || pat.address,
  };
}

export function addNotification(
  db: DatabaseState,
  input: {
    recipient_user_id?: string | null;
    recipient_role?: UserRole | null;
    title: string;
    message: string;
    category: string;
    reference_id?: string | null;
  }
): AppNotification {
  const notif: AppNotification = {
    id: crypto.randomUUID(),
    recipient_user_id: input.recipient_user_id ?? null,
    recipient_role: input.recipient_role ?? null,
    title: input.title,
    message: input.message,
    category: input.category,
    reference_id: input.reference_id ?? null,
    is_read: false,
    created_at: isoNow(),
  };
  db.notifications.unshift(notif);
  return notif;
}

export function addActivityLog(
  db: DatabaseState,
  input: {
    actor_id: string | null;
    actor_name: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    details?: string | null;
  }
): ActivityLog {
  const log: ActivityLog = {
    id: crypto.randomUUID(),
    actor_id: input.actor_id,
    actor_name: input.actor_name,
    actor_role: input.actor_role,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    details: input.details ?? null,
    created_at: isoNow(),
  };
  db.activity_logs.unshift(log);
  return log;
}
