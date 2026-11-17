-- =============================================================================
-- FUDMA HEALTHCENTER: Seed Data (003_seed_data.sql)
-- Fictional academic demonstration data only.
-- =============================================================================

INSERT INTO public.departments (name, code, description, location) VALUES
  ('General Outpatient & Family Medicine', 'GOPD', 'Primary university healthcare, acute illness triage, and general consultations.', 'Ground Floor, Block A'),
  ('Nursing & Triage Station', 'NURS', 'Patient registration verification, vital signs recording, and queue allocation.', 'Main Reception Hall'),
  ('Medical Laboratory Services', 'LABS', 'Hematology, clinical chemistry, malaria parasitology, and urinalysis.', 'Wing B, Diagnostics'),
  ('Hospital Pharmacy & Dispensary', 'PHAR', 'Prescription verification, essential medicine dispensing, and stock management.', 'Ground Floor, Wing C'),
  ('Maternal, Wellness & Preventive Care', 'MWPC', 'Routine immunization, health screenings, and preventive medical counseling.', 'First Floor, Block A')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.medications (sku, name, generic_name, category, dosage_form, strength, stock_quantity, reorder_level, unit_label, expiry_date) VALUES
  ('MED-001', 'Coartem 80/480mg', 'Artemether / Lumefantrine', 'Antimalarial', 'Tablet', '80mg / 480mg', 180, 40, 'Courses', '2027-08-30'),
  ('MED-002', 'Amoxil 500mg', 'Amoxicillin', 'Antibiotic', 'Capsule', '500mg', 240, 50, 'Packs', '2027-11-15'),
  ('MED-003', 'Emzor Paracetamol', 'Acetaminophen', 'Analgesic', 'Tablet', '500mg', 520, 100, 'Blister Packs', '2028-02-20'),
  ('MED-004', 'Augmentin 625mg', 'Amoxicillin / Clavulanate', 'Antibiotic', 'Tablet', '625mg', 18, 25, 'Packs', '2027-06-10'),
  ('MED-005', 'Ciprotab 500mg', 'Ciprofloxacin', 'Antibiotic', 'Tablet', '500mg', 95, 30, 'Packs', '2027-09-12'),
  ('MED-006', 'Omeprazole 20mg', 'Omeprazole', 'Gastrointestinal', 'Capsule', '20mg', 140, 30, 'Packs', '2027-12-01'),
  ('MED-007', 'Oral Rehydration Salts (ORS)', 'Glucose / Electrolytes', 'Rehydration', 'Sachet', '20.5g', 310, 60, 'Sachets', '2028-04-18'),
  ('MED-008', 'Loratadine 10mg', 'Loratadine', 'Antihistamine', 'Tablet', '10mg', 14, 20, 'Packs', '2027-05-25'),
  ('MED-009', 'Amlodipine 5mg', 'Amlodipine Besylate', 'Antihypertensive', 'Tablet', '5mg', 88, 25, 'Packs', '2027-10-14'),
  ('MED-010', 'Ferrous Sulfate + Folic Acid', 'Iron / Folate', 'Hematinic', 'Tablet', '200mg / 400mcg', 210, 40, 'Packs', '2028-01-30')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.system_settings (
  hospital_name,
  institution_name,
  clinic_hours,
  max_daily_appointments,
  allow_patient_cancellations,
  appointment_slot_minutes
)
SELECT
  'FUDMA HEALTHCENTER',
  'Federal University Dutsin-Ma',
  '08:00 - 18:00 (24/7 Emergency Triage)',
  120,
  TRUE,
  30
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings);
