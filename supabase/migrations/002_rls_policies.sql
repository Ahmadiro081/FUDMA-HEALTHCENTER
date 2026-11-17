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
    CASE
      WHEN NEW.raw_user_meta_data->>'gender' IN ('Male', 'Female', 'Other')
        THEN NEW.raw_user_meta_data->>'gender'
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;

  -- Security invariant: Public registration ALWAYS receives 'patient' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'patient')
  ON CONFLICT (user_id) DO NOTHING;

  generated_hosp_no := 'FUDMA-HC-' || TO_CHAR(NOW(), 'YYMM') || '-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 5));

  INSERT INTO public.patients (profile_id, hospital_number, matric_or_staff_id, patient_category)
  VALUES (
    NEW.id,
    generated_hosp_no,
    NEW.raw_user_meta_data->>'matric_or_staff_id',
    CASE
      WHEN NEW.raw_user_meta_data->>'patient_category' IN ('Student', 'Staff', 'Dependent', 'Community')
        THEN NEW.raw_user_meta_data->>'patient_category'
      ELSE 'Student'
    END
  )
  ON CONFLICT (profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Role & identity helper functions (Security Definer avoids recursive RLS evaluation)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_doctor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.doctors WHERE profile_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_patient_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.patients WHERE profile_id = auth.uid() LIMIT 1;
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
DROP POLICY IF EXISTS "Users view own profile or clinical staff view profiles" ON public.profiles;
CREATE POLICY "Users view own profile or clinical staff view profiles"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
    OR (
      public.get_my_role() = 'patient'
      AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = id)
    )
    OR (
      public.get_my_role() = 'lab'
      AND (
        EXISTS (
          SELECT 1 FROM public.laboratory_requests lr
          JOIN public.patients p ON p.id = lr.patient_id
          WHERE p.profile_id = id
        )
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = id)
      )
    )
    OR (
      public.get_my_role() = 'pharmacy'
      AND (
        EXISTS (
          SELECT 1 FROM public.prescriptions pr
          JOIN public.patients p ON p.id = pr.patient_id
          WHERE p.profile_id = id
        )
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = id)
        OR EXISTS (SELECT 1 FROM public.pharmacy_dispensing pd WHERE pd.dispensed_by = id)
      )
    )
  );

DROP POLICY IF EXISTS "Users update own profile or admin updates any" ON public.profiles;
CREATE POLICY "Users update own profile or admin updates any"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (id = auth.uid() OR public.get_my_role() = 'admin');

-- USER ROLES (Admin managed; users can read own role)
DROP POLICY IF EXISTS "Users read own role or admin reads all" ON public.user_roles;
CREATE POLICY "Users read own role or admin reads all"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Only admin assigns or modifies roles" ON public.user_roles;
CREATE POLICY "Only admin assigns or modifies roles"
  ON public.user_roles FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- DEPARTMENTS (Publicly readable when active for clinic directory; managed by admin)
DROP POLICY IF EXISTS "Authenticated users view departments" ON public.departments;
DROP POLICY IF EXISTS "Public views active departments; admin views all" ON public.departments;
CREATE POLICY "Public views active departments; admin views all"
  ON public.departments FOR SELECT
  USING (is_active = TRUE OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admin manages departments" ON public.departments;
CREATE POLICY "Admin manages departments"
  ON public.departments FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- DOCTORS
DROP POLICY IF EXISTS "Authenticated users view doctors" ON public.doctors;
CREATE POLICY "Authenticated users view doctors"
  ON public.doctors FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin manages doctors" ON public.doctors;
CREATE POLICY "Admin manages doctors"
  ON public.doctors FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- PATIENTS (Strict role isolation; lab/pharmacy scoped only to active orders/prescriptions)
DROP POLICY IF EXISTS "Patients view own record; clinical staff view patients" ON public.patients;
CREATE POLICY "Patients view own record; clinical staff view patients"
  ON public.patients FOR SELECT
  USING (
    profile_id = auth.uid()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
    OR (
      public.get_my_role() = 'lab'
      AND EXISTS (SELECT 1 FROM public.laboratory_requests lr WHERE lr.patient_id = id)
    )
    OR (
      public.get_my_role() = 'pharmacy'
      AND EXISTS (SELECT 1 FROM public.prescriptions pr WHERE pr.patient_id = id)
    )
  );

DROP POLICY IF EXISTS "Patients update own info; nurse/admin manage patients" ON public.patients;
CREATE POLICY "Patients update own info; nurse/admin manage patients"
  ON public.patients FOR UPDATE
  USING (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin'))
  WITH CHECK (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin'));

DROP POLICY IF EXISTS "Nurses and admins register walk-in patients" ON public.patients;
CREATE POLICY "Nurses and admins register walk-in patients"
  ON public.patients FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'admin'));

-- APPOINTMENTS (Lab and pharmacy excluded; doctor scoped to assigned/waiting)
DROP POLICY IF EXISTS "Patients see own appointments; staff see relevant appointments" ON public.appointments;
CREATE POLICY "Patients see own appointments; staff see relevant appointments"
  ON public.appointments FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('nurse', 'admin')
    OR (
      public.get_my_role() = 'doctor'
      AND (
        doctor_id = public.get_my_doctor_id()
        OR (doctor_id IS NULL AND status IN ('Checked In', 'Waiting'))
      )
    )
  );

DROP POLICY IF EXISTS "Patients book appointments; nurse and admin create appointments" ON public.appointments;
CREATE POLICY "Patients book appointments; nurse and admin create appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('nurse', 'admin')
  );

DROP POLICY IF EXISTS "Patients cancel own; nurse/doctor/admin update appointments" ON public.appointments;
CREATE POLICY "Patients cancel own; nurse/doctor/admin update appointments"
  ON public.appointments FOR UPDATE
  USING (
    (patient_id = public.get_my_patient_id() AND status IN ('Booked', 'Approved', 'Rescheduled'))
    OR public.get_my_role() IN ('nurse', 'admin')
    OR (
      public.get_my_role() = 'doctor'
      AND (doctor_id = public.get_my_doctor_id() OR (doctor_id IS NULL AND status IN ('Checked In', 'Waiting')))
    )
  )
  WITH CHECK (
    (patient_id = public.get_my_patient_id() AND status = 'Cancelled')
    OR public.get_my_role() IN ('nurse', 'admin')
    OR (
      public.get_my_role() = 'doctor'
      AND (doctor_id = public.get_my_doctor_id() OR doctor_id IS NULL)
    )
  );

-- PATIENT VITALS (Lab and pharmacy excluded)
DROP POLICY IF EXISTS "Patients view own vitals; nurse/doctor/admin view all" ON public.patient_vitals;
CREATE POLICY "Patients view own vitals; nurse/doctor/admin view all"
  ON public.patient_vitals FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin')
  );

DROP POLICY IF EXISTS "Nurses and doctors record vitals" ON public.patient_vitals;
CREATE POLICY "Nurses and doctors record vitals"
  ON public.patient_vitals FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'doctor', 'admin') AND recorded_by = auth.uid());

-- CONSULTATIONS
DROP POLICY IF EXISTS "Patients view own consultations; doctors/nurses/admin view" ON public.consultations;
CREATE POLICY "Patients view own consultations; doctors/nurses/admin view"
  ON public.consultations FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'nurse', 'admin')
  );

DROP POLICY IF EXISTS "Doctors create and update consultations" ON public.consultations;
DROP POLICY IF EXISTS "Doctors insert own consultations; admin inserts any" ON public.consultations;
DROP POLICY IF EXISTS "Doctors update own consultations; admin updates any" ON public.consultations;

CREATE POLICY "Doctors insert own consultations; admin inserts any"
  ON public.consultations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

CREATE POLICY "Doctors update own consultations; admin updates any"
  ON public.consultations FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

-- LABORATORY REQUESTS & RESULTS
DROP POLICY IF EXISTS "Patients view own lab requests; doctor/lab/admin view" ON public.laboratory_requests;
CREATE POLICY "Patients view own lab requests; doctor/lab/admin view"
  ON public.laboratory_requests FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'lab', 'admin')
  );

DROP POLICY IF EXISTS "Doctors create lab requests" ON public.laboratory_requests;
CREATE POLICY "Doctors create lab requests"
  ON public.laboratory_requests FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

DROP POLICY IF EXISTS "Lab staff and doctors update lab requests" ON public.laboratory_requests;
CREATE POLICY "Lab staff and doctors update lab requests"
  ON public.laboratory_requests FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'lab' AND status <> 'Reviewed')
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id() AND status = 'Completed')
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'lab' AND status IN ('Pending', 'Sample Collected', 'Processing', 'Completed'))
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id() AND status = 'Reviewed')
  );

DROP POLICY IF EXISTS "Patients view own lab results; lab/doctor/admin view" ON public.laboratory_results;
CREATE POLICY "Patients view own lab results; lab/doctor/admin view"
  ON public.laboratory_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.laboratory_requests lr
      WHERE lr.id = lab_request_id AND lr.patient_id = public.get_my_patient_id()
    )
    OR public.get_my_role() IN ('lab', 'doctor', 'admin')
  );

DROP POLICY IF EXISTS "Lab staff record results; doctors mark reviewed" ON public.laboratory_results;
DROP POLICY IF EXISTS "Lab staff insert results" ON public.laboratory_results;
DROP POLICY IF EXISTS "Lab staff edit unreviewed results; doctors mark reviewed" ON public.laboratory_results;

CREATE POLICY "Lab staff insert results"
  ON public.laboratory_results FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('lab', 'admin')
    AND recorded_by = auth.uid()
    AND reviewed_by_doctor = FALSE
  );

CREATE POLICY "Lab staff edit unreviewed results; doctors mark reviewed"
  ON public.laboratory_results FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'lab'
      AND EXISTS (
        SELECT 1 FROM public.laboratory_requests lr
        WHERE lr.id = lab_request_id AND lr.status <> 'Reviewed'
      )
    )
    OR (
      public.get_my_role() = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.laboratory_requests lr
        WHERE lr.id = lab_request_id AND lr.doctor_id = public.get_my_doctor_id() AND lr.status = 'Completed'
      )
    )
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'lab' AND reviewed_by_doctor = FALSE)
    OR (public.get_my_role() = 'doctor' AND reviewed_by_doctor = TRUE)
  );

-- MEDICATIONS & PRESCRIPTIONS & DISPENSING
DROP POLICY IF EXISTS "Clinical staff view medications" ON public.medications;
CREATE POLICY "Clinical staff view medications"
  ON public.medications FOR SELECT
  USING (public.get_my_role() IN ('pharmacy', 'doctor', 'admin', 'nurse'));

DROP POLICY IF EXISTS "Pharmacy and admin manage medication stock" ON public.medications;
CREATE POLICY "Pharmacy and admin manage medication stock"
  ON public.medications FOR ALL
  USING (public.get_my_role() IN ('pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin'));

DROP POLICY IF EXISTS "Patients view own prescriptions; doctor/pharmacy/admin view" ON public.prescriptions;
CREATE POLICY "Patients view own prescriptions; doctor/pharmacy/admin view"
  ON public.prescriptions FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin')
  );

DROP POLICY IF EXISTS "Doctors create prescriptions; pharmacy updates fulfillment" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors create prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Pharmacy and admin update prescription status" ON public.prescriptions;

CREATE POLICY "Doctors create prescriptions"
  ON public.prescriptions FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

CREATE POLICY "Pharmacy and admin update prescription status"
  ON public.prescriptions FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin'));

DROP POLICY IF EXISTS "Patients view own prescription items; doctor/pharmacy/admin view" ON public.prescription_items;
CREATE POLICY "Patients view own prescription items; doctor/pharmacy/admin view"
  ON public.prescription_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.id = prescription_id AND pr.patient_id = public.get_my_patient_id()
    )
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin')
  );

DROP POLICY IF EXISTS "Doctors and pharmacy manage prescription items" ON public.prescription_items;
DROP POLICY IF EXISTS "Doctors insert items for own prescriptions" ON public.prescription_items;
DROP POLICY IF EXISTS "Pharmacy and admin update dispensing quantities" ON public.prescription_items;

CREATE POLICY "Doctors insert items for own prescriptions"
  ON public.prescription_items FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.id = prescription_id AND pr.doctor_id = public.get_my_doctor_id()
      )
    )
  );

CREATE POLICY "Pharmacy and admin update dispensing quantities"
  ON public.prescription_items FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy', 'admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin'));

DROP POLICY IF EXISTS "Pharmacy and admin manage dispensing records" ON public.pharmacy_dispensing;
DROP POLICY IF EXISTS "Pharmacy and admin read dispensing records" ON public.pharmacy_dispensing;
DROP POLICY IF EXISTS "Pharmacy and admin insert dispensing records" ON public.pharmacy_dispensing;

CREATE POLICY "Pharmacy and admin read dispensing records"
  ON public.pharmacy_dispensing FOR SELECT
  USING (public.get_my_role() IN ('pharmacy', 'admin'));

CREATE POLICY "Pharmacy and admin insert dispensing records"
  ON public.pharmacy_dispensing FOR INSERT
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin') AND dispensed_by = auth.uid());

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Users read notifications for their user or role" ON public.notifications;
CREATE POLICY "Users read notifications for their user or role"
  ON public.notifications FOR SELECT
  USING (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
  );

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
    OR public.get_my_role() = 'admin'
  )
  WITH CHECK (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Authenticated workflow creates notifications" ON public.notifications;
DROP POLICY IF EXISTS "Clinical staff create workflow notifications" ON public.notifications;
CREATE POLICY "Clinical staff create workflow notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'doctor', 'lab', 'pharmacy', 'admin'));

-- ACTIVITY LOGS & SYSTEM SETTINGS
DROP POLICY IF EXISTS "Admin views activity logs" ON public.activity_logs;
CREATE POLICY "Admin views activity logs"
  ON public.activity_logs FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated actions write activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Users log own verified actions" ON public.activity_logs;
CREATE POLICY "Users log own verified actions"
  ON public.activity_logs FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND actor_id = auth.uid()
    AND actor_role = public.get_my_role()
  );

DROP POLICY IF EXISTS "Authenticated users read settings; admin updates" ON public.system_settings;
DROP POLICY IF EXISTS "Public views clinic system settings" ON public.system_settings;
CREATE POLICY "Public views clinic system settings"
  ON public.system_settings FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Only admin updates system settings" ON public.system_settings;
CREATE POLICY "Only admin updates system settings"
  ON public.system_settings FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
