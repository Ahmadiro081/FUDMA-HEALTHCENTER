-- =============================================================================
-- FUDMA HEALTHCENTER: Row Level Security & Auth Role Protection (002_rls_policies.sql)
-- =============================================================================

-- Enforce patient-only role on public self-registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_hosp_no TEXT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, gender)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'gender'
  );

  -- Security invariant: Public registration ALWAYS receives 'patient' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'patient');

  generated_hosp_no := 'FUDMA-HC-' || TO_CHAR(NOW(), 'YYMM') || '-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 5));

  INSERT INTO public.patients (profile_id, hospital_number, matric_or_staff_id, patient_category)
  VALUES (
    NEW.id,
    generated_hosp_no,
    NEW.raw_user_meta_data->>'matric_or_staff_id',
    COALESCE(NEW.raw_user_meta_data->>'patient_category', 'Student')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Role helper function (Security Definer avoids recursive RLS evaluation)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Enable RLS across all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratory_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratory_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_dispensing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "Users view own profile or clinical staff view profiles"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.get_my_role() IN ('nurse', 'doctor', 'lab', 'pharmacy', 'admin'));

CREATE POLICY "Users update own profile or admin updates any"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (id = auth.uid() OR public.get_my_role() = 'admin');

-- USER ROLES (Admin managed; users can read own role)
CREATE POLICY "Users read own role or admin reads all"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');

CREATE POLICY "Only admin assigns or modifies roles"
  ON public.user_roles FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- DEPARTMENTS & DOCTORS (Readable by authenticated users; managed by admin)
CREATE POLICY "Authenticated users view departments"
  ON public.departments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin manages departments"
  ON public.departments FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "Authenticated users view doctors"
  ON public.doctors FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin manages doctors"
  ON public.doctors FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- PATIENTS
CREATE POLICY "Patients view own record; clinical staff view patients"
  ON public.patients FOR SELECT
  USING (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'doctor', 'lab', 'pharmacy', 'admin'));

CREATE POLICY "Patients update own info; nurse/admin manage patients"
  ON public.patients FOR UPDATE
  USING (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin'))
  WITH CHECK (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin'));

CREATE POLICY "Nurses and admins register walk-in patients"
  ON public.patients FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'admin'));

-- APPOINTMENTS
CREATE POLICY "Patients see own appointments; staff see relevant appointments"
  ON public.appointments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
  );

CREATE POLICY "Patients book appointments; nurse and admin create appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('nurse', 'admin')
  );

CREATE POLICY "Patients cancel own; nurse/doctor/admin update appointments"
  ON public.appointments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
  );

-- PATIENT VITALS
CREATE POLICY "Patients view own vitals; nurse/doctor/admin view all"
  ON public.patient_vitals FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
  );

CREATE POLICY "Nurses and doctors record vitals"
  ON public.patient_vitals FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'doctor', 'admin'));

-- CONSULTATIONS
CREATE POLICY "Patients view own consultations; doctors/nurses/admin view"
  ON public.consultations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('doctor', 'nurse', 'admin')
  );

CREATE POLICY "Doctors create and update consultations"
  ON public.consultations FOR ALL
  USING (public.get_my_role() IN ('doctor', 'admin'))
  WITH CHECK (public.get_my_role() IN ('doctor', 'admin'));

-- LABORATORY REQUESTS & RESULTS
CREATE POLICY "Patients view own lab requests; doctor/lab/admin view"
  ON public.laboratory_requests FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('doctor', 'lab', 'admin')
  );

CREATE POLICY "Doctors create lab requests"
  ON public.laboratory_requests FOR INSERT
  WITH CHECK (public.get_my_role() IN ('doctor', 'admin'));

CREATE POLICY "Lab staff and doctors update lab requests"
  ON public.laboratory_requests FOR UPDATE
  USING (public.get_my_role() IN ('lab', 'doctor', 'admin'));

CREATE POLICY "Patients view own lab results; lab/doctor/admin view"
  ON public.laboratory_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.laboratory_requests lr
      JOIN public.patients p ON p.id = lr.patient_id
      WHERE lr.id = lab_request_id AND p.profile_id = auth.uid()
    )
    OR public.get_my_role() IN ('lab', 'doctor', 'admin')
  );

CREATE POLICY "Lab staff record results; doctors mark reviewed"
  ON public.laboratory_results FOR ALL
  USING (public.get_my_role() IN ('lab', 'doctor', 'admin'))
  WITH CHECK (public.get_my_role() IN ('lab', 'doctor', 'admin'));

-- MEDICATIONS & PRESCRIPTIONS & DISPENSING
CREATE POLICY "Clinical staff view medications"
  ON public.medications FOR SELECT
  USING (public.get_my_role() IN ('pharmacy', 'doctor', 'admin', 'nurse'));

CREATE POLICY "Pharmacy and admin manage medication stock"
  ON public.medications FOR ALL
  USING (public.get_my_role() IN ('pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin'));

CREATE POLICY "Patients view own prescriptions; doctor/pharmacy/admin view"
  ON public.prescriptions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.profile_id = auth.uid())
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin')
  );

CREATE POLICY "Doctors create prescriptions; pharmacy updates fulfillment"
  ON public.prescriptions FOR ALL
  USING (public.get_my_role() IN ('doctor', 'pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('doctor', 'pharmacy', 'admin'));

CREATE POLICY "Patients view own prescription items; doctor/pharmacy/admin view"
  ON public.prescription_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.prescriptions pr
      JOIN public.patients p ON p.id = pr.patient_id
      WHERE pr.id = prescription_id AND p.profile_id = auth.uid()
    )
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin')
  );

CREATE POLICY "Doctors and pharmacy manage prescription items"
  ON public.prescription_items FOR ALL
  USING (public.get_my_role() IN ('doctor', 'pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('doctor', 'pharmacy', 'admin'));

CREATE POLICY "Pharmacy and admin manage dispensing records"
  ON public.pharmacy_dispensing FOR ALL
  USING (public.get_my_role() IN ('pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin'));

-- NOTIFICATIONS
CREATE POLICY "Users read notifications for their user or role"
  ON public.notifications FOR SELECT
  USING (recipient_user_id = auth.uid() OR recipient_role = public.get_my_role() OR public.get_my_role() = 'admin');

CREATE POLICY "Users mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (recipient_user_id = auth.uid() OR recipient_role = public.get_my_role() OR public.get_my_role() = 'admin');

CREATE POLICY "Authenticated workflow creates notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ACTIVITY LOGS & SYSTEM SETTINGS
CREATE POLICY "Admin views activity logs"
  ON public.activity_logs FOR SELECT
  USING (public.get_my_role() = 'admin');

CREATE POLICY "Authenticated actions write activity logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users read settings; admin updates"
  ON public.system_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admin updates system settings"
  ON public.system_settings FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
