-- =============================================================================
-- FUDMA HEALTHCENTER: Privileged Super Admin Identity, Separation & Audit
-- Migration: 006_super_admin.sql
-- Purpose:
--   1. Support 'super_admin' role & immutable public.privileged_accounts registry
--   2. Isolate ENG/2011/0001 from group11_student_whitelist (never whitelisted)
--   3. Allow account_origin = 'super_admin_provision' in handle_new_user() while
--      strictly blocking ENG/2011/0001 on public self-registration
--   4. Prevent any ordinary admin or student from modifying, suspending,
--      demoting, or deleting the Super Admin account
--   5. Upgrade RLS policies, protection triggers, and all 10 transactional RPCs
--      to support 'super_admin' with exclusive admin governance
-- IMPORTANT: Does NOT auto-create or seed any Super Admin user or password.
-- Safe to run after 001..005 migrations.
-- =============================================================================

-- 1. Expand user_roles CHECK constraint to include 'super_admin'
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('patient', 'nurse', 'lab', 'pharmacy', 'doctor', 'admin', 'super_admin'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_single_super_admin
  ON public.user_roles (role)
  WHERE role = 'super_admin';

-- 1b. Expand notifications.recipient_role CHECK constraint to include 'super_admin'
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%recipient_role%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_recipient_role_check
  CHECK (recipient_role IN ('patient', 'nurse', 'lab', 'pharmacy', 'doctor', 'admin', 'super_admin'));

-- 2. Privileged Administrative Account Registry (separate from Group 11 whitelist)
CREATE TABLE IF NOT EXISTS public.privileged_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  login_username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('super_admin')),
  account_type TEXT NOT NULL DEFAULT 'Privileged Administrative Account',
  is_immutable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_privileged_username_normalized
    CHECK (login_username = public.normalize_matric_number(login_username) AND LENGTH(login_username) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_privileged_accounts_norm_username
  ON public.privileged_accounts (public.normalize_matric_number(login_username));

ALTER TABLE public.privileged_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only super_admin reads privileged accounts" ON public.privileged_accounts;
CREATE POLICY "Only super_admin reads privileged accounts"
  ON public.privileged_accounts FOR SELECT
  USING (public.get_my_role() = 'super_admin');

-- 3. Role & protection helper functions
CREATE OR REPLACE FUNCTION public.is_admin_or_super()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role(), '') IN ('admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role(), '') = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_protected_super_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.privileged_accounts
    WHERE user_id = p_user_id
  );
$$;

-- 4. Guard Group 11 whitelist against reserved Super Admin login usernames
CREATE OR REPLACE FUNCTION public.trg_fn_protect_whitelist_reserved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := public.normalize_matric_number(NEW.matric_number);
BEGIN
  IF v_norm = 'ENG/2011/0001' OR EXISTS (
    SELECT 1 FROM public.privileged_accounts
    WHERE public.normalize_matric_number(login_username) = v_norm
  ) THEN
    RAISE EXCEPTION 'Privileged administrative login usernames cannot be added to the Group 11 student whitelist.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_whitelist_reserved ON public.group11_student_whitelist;
CREATE TRIGGER trg_protect_whitelist_reserved
  BEFORE INSERT OR UPDATE ON public.group11_student_whitelist
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_protect_whitelist_reserved();

-- 5. Make public.privileged_accounts strictly immutable against updates or deletions
CREATE OR REPLACE FUNCTION public.trg_fn_protect_privileged_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Privileged Super Admin account registry entries are immutable and cannot be modified or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_privileged_accounts ON public.privileged_accounts;
CREATE TRIGGER trg_protect_privileged_accounts
  BEFORE UPDATE OR DELETE ON public.privileged_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_protect_privileged_accounts();

-- 6. Immutable Super Admin & Exclusive Admin-Governance Triggers on user_roles and profiles
CREATE OR REPLACE FUNCTION public.trg_fn_protect_user_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_svc BOOLEAN := public.is_service_context();
  v_is_super BOOLEAN := public.is_super_admin();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' OR EXISTS (
      SELECT 1 FROM public.privileged_accounts WHERE user_id = OLD.user_id
    ) THEN
      RAISE EXCEPTION 'The Super Admin account cannot be stripped of privileges or deleted.';
    END IF;
    IF NOT v_is_svc AND OLD.role = 'admin' AND NOT v_is_super THEN
      RAISE EXCEPTION 'Only the Super Administrator may revoke administrator roles.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'super_admin' AND NOT v_is_svc THEN
      RAISE EXCEPTION 'Super Admin accounts can only be provisioned via the secure server-side process.';
    END IF;
    IF NEW.role = 'admin' AND NOT v_is_svc AND NOT v_is_super THEN
      RAISE EXCEPTION 'Only the Super Administrator may assign administrator roles.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_admin' OR EXISTS (
      SELECT 1 FROM public.privileged_accounts WHERE user_id = OLD.user_id
    ) THEN
      IF NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'The Super Admin account is protected and cannot be demoted or reassigned.';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.role = 'super_admin' AND NOT v_is_svc THEN
      RAISE EXCEPTION 'Super Admin privilege escalation is strictly prohibited.';
    END IF;

    IF (OLD.role = 'admin' OR NEW.role = 'admin') AND NOT v_is_svc AND NOT v_is_super THEN
      RAISE EXCEPTION 'Only the Super Administrator may assign or modify administrator roles.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_roles ON public.user_roles;
CREATE TRIGGER trg_protect_user_roles
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_protect_user_roles();

CREATE OR REPLACE FUNCTION public.trg_fn_protect_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_svc BOOLEAN := public.is_service_context();
  v_actor_role TEXT := COALESCE(public.get_my_role(), '');
  v_target_role TEXT;
  v_target_is_super BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.is_protected_super_admin(OLD.id) THEN
      RAISE EXCEPTION 'The Super Admin profile is protected and cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  v_target_is_super := public.is_protected_super_admin(OLD.id);
  IF v_target_is_super THEN
    IF NEW.is_active = FALSE THEN
      RAISE EXCEPTION 'The Super Admin account cannot be suspended or deactivated.';
    END IF;
    IF NOT v_is_svc AND auth.uid() IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'No ordinary administrator or student may modify the Super Admin account.';
    END IF;
    IF NOT v_is_svc AND NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Email address cannot be modified directly.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_is_svc OR v_actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  IF v_actor_role = 'admin' THEN
    SELECT role INTO v_target_role FROM public.user_roles WHERE user_id = OLD.id;
    IF v_target_role = 'admin' AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Only the Super Administrator may suspend or reactivate administrator accounts.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only an administrator may change account activation status.';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Email address cannot be modified directly.';
  END IF;
  IF NEW.full_name IS DISTINCT FROM OLD.full_name
     AND EXISTS (SELECT 1 FROM public.group11_student_whitelist WHERE registered_user_id = OLD.id) THEN
    RAISE EXCEPTION 'Verified Group 11 student full name cannot be modified after registration.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profiles ON public.profiles;
CREATE TRIGGER trg_protect_profiles
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_protect_profiles();

-- 6b. Update Step-1 matriculation verification RPC so ENG/2011/0001 is explicitly
--     recognised as the designated Initial Super Administrator identity and exempted
--     from Group 11 patient whitelist self-registration without auto-creating any account.
CREATE OR REPLACE FUNCTION public.rpc_verify_group11_matric(p_matric_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_wl RECORD;
  v_is_provisioned BOOLEAN;
BEGIN
  v_norm := public.normalize_matric_number(p_matric_number);

  IF v_norm = '' OR v_norm !~ '^[A-Z0-9]+/[0-9]{4}/[0-9]+$' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'INVALID_FORMAT',
      'message', 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.'
    );
  END IF;

  IF v_norm = 'ENG/2011/0001' OR EXISTS (
    SELECT 1 FROM public.privileged_accounts
    WHERE public.normalize_matric_number(login_username) = v_norm
  ) THEN
    SELECT (
      EXISTS (
        SELECT 1 FROM public.privileged_accounts
        WHERE public.normalize_matric_number(login_username) = v_norm
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE role = 'super_admin'
      )
    ) INTO v_is_provisioned;

    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'PRIVILEGED_SUPER_ADMIN',
      'matric_number', v_norm,
      'is_provisioned', v_is_provisioned,
      'message', CASE
        WHEN v_is_provisioned THEN
          'ENG/2011/0001 is the designated Initial Super Administrator identity and has already been provisioned. Please sign in through Portal Sign In with your credentials.'
        ELSE
          'ENG/2011/0001 is recognised as the designated Initial Super Administrator identity. Complete the Initial Super Administrator registration form below to provision your account securely.'
      END
    );
  END IF;

  SELECT full_name, matric_number, department, is_registered, registered_user_id
  INTO v_wl
  FROM public.group11_student_whitelist
  WHERE public.normalize_matric_number(matric_number) = v_norm
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'NOT_FOUND',
      'message', 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.'
    );
  END IF;

  IF v_wl.is_registered = TRUE OR v_wl.registered_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'ALREADY_REGISTERED',
      'message', 'This matriculation number has already been registered. Please sign in with your matriculation number and password.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'code', 'VERIFIED',
    'full_name', v_wl.full_name,
    'matric_number', v_wl.matric_number,
    'department', v_wl.department
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_verify_group11_matric(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_verify_group11_matric(TEXT) TO anon, authenticated;

-- 7. Update handle_new_user() trigger to support server-only 'super_admin_provision' origin
--    while continuing strict Group 11 enforcement on all public signups (explicitly blocking ENG/2011/0001).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_hosp_no TEXT;
  v_account_origin TEXT;
  v_norm_matric TEXT;
  v_wl RECORD;
  v_full_name TEXT;
  v_matric TEXT;
  v_dept TEXT;
  v_phone TEXT;
  v_gender TEXT;
  v_dob DATE;
  v_address TEXT;
  v_category TEXT;
  v_blood TEXT;
  v_genotype TEXT;
BEGIN
  v_account_origin := COALESCE(NEW.raw_app_meta_data->>'account_origin', '');

  v_phone := NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), '');
  v_gender := CASE
    WHEN NEW.raw_user_meta_data->>'gender' IN ('Male', 'Female', 'Other')
      THEN NEW.raw_user_meta_data->>'gender'
    ELSE NULL
  END;
  v_dob := CASE
    WHEN COALESCE(NEW.raw_user_meta_data->>'date_of_birth', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (NEW.raw_user_meta_data->>'date_of_birth')::DATE
    ELSE NULL
  END;
  v_address := NULLIF(TRIM(NEW.raw_user_meta_data->>'address'), '');

  IF v_account_origin IN ('admin_staff', 'super_admin_provision') THEN
    IF v_account_origin = 'super_admin_provision' AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Initial Super Administrator has already been provisioned and cannot be duplicated.';
    END IF;

    v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));

    INSERT INTO public.profiles (id, full_name, email, phone, gender, date_of_birth, address)
    VALUES (NEW.id, v_full_name, NEW.email, v_phone, v_gender, v_dob, v_address)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (
      NEW.id,
      CASE WHEN v_account_origin = 'super_admin_provision' THEN 'super_admin' ELSE 'patient' END
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Public patient registration MUST match an unclaimed Group 11 whitelist record
  v_norm_matric := public.normalize_matric_number(NEW.raw_user_meta_data->>'matric_or_staff_id');
  IF v_norm_matric = '' THEN
    RAISE EXCEPTION 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.';
  END IF;

  IF v_norm_matric = 'ENG/2011/0001' OR EXISTS (
    SELECT 1 FROM public.privileged_accounts
    WHERE public.normalize_matric_number(login_username) = v_norm_matric
  ) THEN
    RAISE EXCEPTION 'Access Denied. % is the designated Super Administrator identity and cannot be registered as a public patient account.', v_norm_matric;
  END IF;

  SELECT *
  INTO v_wl
  FROM public.group11_student_whitelist
  WHERE public.normalize_matric_number(matric_number) = v_norm_matric
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.';
  END IF;

  IF v_wl.is_registered = TRUE OR v_wl.registered_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This matriculation number (%) has already been registered. Please sign in instead.', v_wl.matric_number;
  END IF;

  v_full_name := v_wl.full_name;
  v_matric := v_wl.matric_number;
  v_dept := v_wl.department;
  v_category := 'Student';

  v_blood := CASE
    WHEN NEW.raw_user_meta_data->>'blood_group' IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown')
      THEN NEW.raw_user_meta_data->>'blood_group'
    ELSE 'Unknown'
  END;
  v_genotype := CASE
    WHEN NEW.raw_user_meta_data->>'genotype' IN ('AA', 'AS', 'SS', 'AC', 'SC', 'Unknown')
      THEN NEW.raw_user_meta_data->>'genotype'
    ELSE 'Unknown'
  END;

  INSERT INTO public.profiles (id, full_name, email, phone, gender, date_of_birth, address)
  VALUES (NEW.id, v_full_name, NEW.email, v_phone, v_gender, v_dob, v_address)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'patient')
  ON CONFLICT (user_id) DO NOTHING;

  generated_hosp_no := 'FUDMA-HC-' || TO_CHAR(NOW(), 'YYMM') || '-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 5));

  INSERT INTO public.patients (
    profile_id, hospital_number, matric_or_staff_id, patient_category,
    faculty_or_unit, blood_group, genotype, allergies,
    emergency_contact_name, emergency_contact_phone,
    full_name, email, phone, gender, date_of_birth, address
  )
  VALUES (
    NEW.id,
    generated_hosp_no,
    v_matric,
    v_category,
    v_dept,
    v_blood,
    v_genotype,
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'allergies'), ''), 'None reported'),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'emergency_contact_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'emergency_contact_phone'), ''),
    v_full_name,
    NEW.email,
    v_phone,
    v_gender,
    v_dob,
    v_address
  )
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.group11_student_whitelist
  SET
    is_registered = TRUE,
    registered_user_id = NEW.id,
    registered_at = NOW()
  WHERE id = v_wl.id;

  INSERT INTO public.notifications (recipient_user_id, title, message, category)
  VALUES (
    NEW.id,
    'Welcome to FUDMA HEALTHCENTER',
    'Your verified student patient file (' || generated_hosp_no || ') for ' || v_matric || ' is active.',
    'account'
  );

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    NEW.id,
    v_full_name,
    'patient',
    'GROUP11_PATIENT_REGISTERED',
    'patient',
    generated_hosp_no,
    'Verified Group 11 registration completed for ' || v_matric || ' (' || v_dept || ').'
  );

  RETURN NEW;
END;
$$;

-- 8. Upgrade RLS policies across all tables so 'super_admin' has full clinical & administrative access
--    while enforcing strict Super Admin immutability and exclusive admin governance.

DROP POLICY IF EXISTS "Admins view all whitelist records" ON public.group11_student_whitelist;
CREATE POLICY "Admins view all whitelist records"
  ON public.group11_student_whitelist FOR SELECT
  USING (public.is_admin_or_super());

-- PROFILES
DROP POLICY IF EXISTS "Users view own profile or clinical staff view profiles" ON public.profiles;
CREATE POLICY "Users view own profile or clinical staff view profiles"
  ON public.profiles FOR SELECT
  USING (
    public.profiles.id = auth.uid()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin', 'super_admin')
    OR (
      public.get_my_role() = 'patient'
      AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = public.profiles.id)
    )
    OR (
      public.get_my_role() = 'lab'
      AND (
        EXISTS (
          SELECT 1 FROM public.laboratory_requests lr
          JOIN public.patients p ON p.id = lr.patient_id
          WHERE p.profile_id = public.profiles.id
        )
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = public.profiles.id)
      )
    )
    OR (
      public.get_my_role() = 'pharmacy'
      AND (
        EXISTS (
          SELECT 1 FROM public.prescriptions pr
          JOIN public.patients p ON p.id = pr.patient_id
          WHERE p.profile_id = public.profiles.id
        )
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = public.profiles.id)
        OR EXISTS (SELECT 1 FROM public.pharmacy_dispensing pd WHERE pd.dispensed_by = public.profiles.id)
      )
    )
  );

DROP POLICY IF EXISTS "Users update own profile or admin updates any" ON public.profiles;
CREATE POLICY "Users update own profile or admin updates any"
  ON public.profiles FOR UPDATE
  USING (
    public.profiles.id = auth.uid()
    OR public.is_super_admin()
    OR (public.get_my_role() = 'admin' AND NOT public.is_protected_super_admin(public.profiles.id))
  )
  WITH CHECK (
    public.profiles.id = auth.uid()
    OR public.is_super_admin()
    OR (public.get_my_role() = 'admin' AND NOT public.is_protected_super_admin(public.profiles.id))
  );

-- USER ROLES (Only Super Admin may mutate roles directly; ordinary admins cannot touch admin/super_admin roles)
DROP POLICY IF EXISTS "Users read own role or admin reads all" ON public.user_roles;
CREATE POLICY "Users read own role or admin reads all"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_or_super());

DROP POLICY IF EXISTS "Only admin assigns or modifies roles" ON public.user_roles;
CREATE POLICY "Only admin assigns or modifies roles"
  ON public.user_roles FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin() AND role <> 'super_admin');

-- DEPARTMENTS
DROP POLICY IF EXISTS "Public views active departments; admin views all" ON public.departments;
CREATE POLICY "Public views active departments; admin views all"
  ON public.departments FOR SELECT
  USING (is_active = TRUE OR public.is_admin_or_super());

DROP POLICY IF EXISTS "Admin manages departments" ON public.departments;
CREATE POLICY "Admin manages departments"
  ON public.departments FOR ALL
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- DOCTORS
DROP POLICY IF EXISTS "Admin manages doctors" ON public.doctors;
CREATE POLICY "Admin manages doctors"
  ON public.doctors FOR ALL
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- PATIENTS
DROP POLICY IF EXISTS "Patients view own record; clinical staff view patients" ON public.patients;
CREATE POLICY "Patients view own record; clinical staff view patients"
  ON public.patients FOR SELECT
  USING (
    profile_id = auth.uid()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin', 'super_admin')
    OR (
      public.get_my_role() = 'lab'
      AND EXISTS (SELECT 1 FROM public.laboratory_requests lr WHERE lr.patient_id = public.patients.id)
    )
    OR (
      public.get_my_role() = 'pharmacy'
      AND EXISTS (SELECT 1 FROM public.prescriptions pr WHERE pr.patient_id = public.patients.id)
    )
  );

DROP POLICY IF EXISTS "Patients update own info; nurse/admin manage patients" ON public.patients;
CREATE POLICY "Patients update own info; nurse/admin manage patients"
  ON public.patients FOR UPDATE
  USING (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin', 'super_admin'))
  WITH CHECK (profile_id = auth.uid() OR public.get_my_role() IN ('nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "Nurses and admins register walk-in patients" ON public.patients;
CREATE POLICY "Nurses and admins register walk-in patients"
  ON public.patients FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'admin', 'super_admin'));

-- APPOINTMENTS
DROP POLICY IF EXISTS "Patients see own appointments; staff see relevant appointments" ON public.appointments;
CREATE POLICY "Patients see own appointments; staff see relevant appointments"
  ON public.appointments FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
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
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Patients cancel own; nurse/doctor/admin update appointments" ON public.appointments;
CREATE POLICY "Patients cancel own; nurse/doctor/admin update appointments"
  ON public.appointments FOR UPDATE
  USING (
    (patient_id = public.get_my_patient_id() AND status IN ('Booked', 'Approved', 'Rescheduled'))
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
    OR (
      public.get_my_role() = 'doctor'
      AND (doctor_id = public.get_my_doctor_id() OR (doctor_id IS NULL AND status IN ('Checked In', 'Waiting')))
    )
  )
  WITH CHECK (
    (patient_id = public.get_my_patient_id() AND status = 'Cancelled')
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
    OR (
      public.get_my_role() = 'doctor'
      AND (doctor_id = public.get_my_doctor_id() OR doctor_id IS NULL)
    )
  );

-- PATIENT VITALS
DROP POLICY IF EXISTS "Patients view own vitals; nurse/doctor/admin view all" ON public.patient_vitals;
CREATE POLICY "Patients view own vitals; nurse/doctor/admin view all"
  ON public.patient_vitals FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('nurse', 'doctor', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Nurses and doctors record vitals" ON public.patient_vitals;
CREATE POLICY "Nurses and doctors record vitals"
  ON public.patient_vitals FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'doctor', 'admin', 'super_admin') AND recorded_by = auth.uid());

-- CONSULTATIONS
DROP POLICY IF EXISTS "Patients view own consultations; doctors/nurses/admin view" ON public.consultations;
CREATE POLICY "Patients view own consultations; doctors/nurses/admin view"
  ON public.consultations FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'nurse', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Doctors insert own consultations; admin inserts any" ON public.consultations;
CREATE POLICY "Doctors insert own consultations; admin inserts any"
  ON public.consultations FOR INSERT
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

DROP POLICY IF EXISTS "Doctors update own consultations; admin updates any" ON public.consultations;
CREATE POLICY "Doctors update own consultations; admin updates any"
  ON public.consultations FOR UPDATE
  USING (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  )
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

-- LABORATORY REQUESTS & RESULTS
DROP POLICY IF EXISTS "Patients view own lab requests; doctor/lab/admin view" ON public.laboratory_requests;
CREATE POLICY "Patients view own lab requests; doctor/lab/admin view"
  ON public.laboratory_requests FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'lab', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Doctors create lab requests" ON public.laboratory_requests;
CREATE POLICY "Doctors create lab requests"
  ON public.laboratory_requests FOR INSERT
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

DROP POLICY IF EXISTS "Lab staff and doctors update lab requests" ON public.laboratory_requests;
CREATE POLICY "Lab staff and doctors update lab requests"
  ON public.laboratory_requests FOR UPDATE
  USING (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'lab' AND status <> 'Reviewed')
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id() AND status = 'Completed')
  )
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'lab' AND status IN ('Pending', 'Sample Collected', 'Processing', 'Completed'))
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id() AND status = 'Reviewed')
  );

DROP POLICY IF EXISTS "Patients view own lab results; lab/doctor/admin view" ON public.laboratory_results;
CREATE POLICY "Patients view own lab results; lab/doctor/admin view"
  ON public.laboratory_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.laboratory_requests lr
      WHERE lr.id = public.laboratory_results.lab_request_id AND lr.patient_id = public.get_my_patient_id()
    )
    OR public.get_my_role() IN ('lab', 'doctor', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Lab staff insert results" ON public.laboratory_results;
CREATE POLICY "Lab staff insert results"
  ON public.laboratory_results FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('lab', 'admin', 'super_admin')
    AND recorded_by = auth.uid()
    AND reviewed_by_doctor = FALSE
  );

DROP POLICY IF EXISTS "Lab staff edit unreviewed results; doctors mark reviewed" ON public.laboratory_results;
CREATE POLICY "Lab staff edit unreviewed results; doctors mark reviewed"
  ON public.laboratory_results FOR UPDATE
  USING (
    public.is_admin_or_super()
    OR (
      public.get_my_role() = 'lab'
      AND EXISTS (
        SELECT 1 FROM public.laboratory_requests lr
        WHERE lr.id = public.laboratory_results.lab_request_id AND lr.status <> 'Reviewed'
      )
    )
    OR (
      public.get_my_role() = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.laboratory_requests lr
        WHERE lr.id = public.laboratory_results.lab_request_id AND lr.doctor_id = public.get_my_doctor_id() AND lr.status = 'Completed'
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'lab' AND reviewed_by_doctor = FALSE)
    OR (public.get_my_role() = 'doctor' AND reviewed_by_doctor = TRUE)
  );

-- MEDICATIONS & PRESCRIPTIONS & DISPENSING
DROP POLICY IF EXISTS "Clinical staff view medications" ON public.medications;
CREATE POLICY "Clinical staff view medications"
  ON public.medications FOR SELECT
  USING (public.get_my_role() IN ('pharmacy', 'doctor', 'admin', 'super_admin', 'nurse'));

DROP POLICY IF EXISTS "Pharmacy and admin manage medication stock" ON public.medications;
CREATE POLICY "Pharmacy and admin manage medication stock"
  ON public.medications FOR ALL
  USING (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "Patients view own prescriptions; doctor/pharmacy/admin view" ON public.prescriptions;
CREATE POLICY "Patients view own prescriptions; doctor/pharmacy/admin view"
  ON public.prescriptions FOR SELECT
  USING (
    patient_id = public.get_my_patient_id()
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Doctors create prescriptions" ON public.prescriptions;
CREATE POLICY "Doctors create prescriptions"
  ON public.prescriptions FOR INSERT
  WITH CHECK (
    public.is_admin_or_super()
    OR (public.get_my_role() = 'doctor' AND doctor_id = public.get_my_doctor_id())
  );

DROP POLICY IF EXISTS "Pharmacy and admin update prescription status" ON public.prescriptions;
CREATE POLICY "Pharmacy and admin update prescription status"
  ON public.prescriptions FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "Patients view own prescription items; doctor/pharmacy/admin view" ON public.prescription_items;
CREATE POLICY "Patients view own prescription items; doctor/pharmacy/admin view"
  ON public.prescription_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.id = public.prescription_items.prescription_id AND pr.patient_id = public.get_my_patient_id()
    )
    OR public.get_my_role() IN ('doctor', 'pharmacy', 'admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Doctors insert items for own prescriptions" ON public.prescription_items;
CREATE POLICY "Doctors insert items for own prescriptions"
  ON public.prescription_items FOR INSERT
  WITH CHECK (
    public.is_admin_or_super()
    OR (
      public.get_my_role() = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.id = public.prescription_items.prescription_id AND pr.doctor_id = public.get_my_doctor_id()
      )
    )
  );

DROP POLICY IF EXISTS "Pharmacy and admin update dispensing quantities" ON public.prescription_items;
CREATE POLICY "Pharmacy and admin update dispensing quantities"
  ON public.prescription_items FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "Pharmacy and admin read dispensing records" ON public.pharmacy_dispensing;
CREATE POLICY "Pharmacy and admin read dispensing records"
  ON public.pharmacy_dispensing FOR SELECT
  USING (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "Pharmacy and admin insert dispensing records" ON public.pharmacy_dispensing;
CREATE POLICY "Pharmacy and admin insert dispensing records"
  ON public.pharmacy_dispensing FOR INSERT
  WITH CHECK (public.get_my_role() IN ('pharmacy', 'admin', 'super_admin') AND dispensed_by = auth.uid());

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
    OR public.is_admin_or_super()
  )
  WITH CHECK (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
    OR public.is_admin_or_super()
  );

DROP POLICY IF EXISTS "Clinical staff create workflow notifications" ON public.notifications;
CREATE POLICY "Clinical staff create workflow notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (public.get_my_role() IN ('nurse', 'doctor', 'lab', 'pharmacy', 'admin', 'super_admin'));

-- ACTIVITY LOGS & SYSTEM SETTINGS
DROP POLICY IF EXISTS "Admin views activity logs" ON public.activity_logs;
CREATE POLICY "Admin views activity logs"
  ON public.activity_logs FOR SELECT
  USING (public.is_admin_or_super());

DROP POLICY IF EXISTS "Only admin updates system settings" ON public.system_settings;
CREATE POLICY "Only admin updates system settings"
  ON public.system_settings FOR ALL
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- 9. Upgrade workflow protection trigger functions from 004/005 to recognize 'super_admin'
CREATE OR REPLACE FUNCTION public.trg_fn_protect_patients()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_context() OR public.get_my_role() IN ('nurse', 'admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.hospital_number IS DISTINCT FROM OLD.hospital_number
     OR NEW.matric_or_staff_id IS DISTINCT FROM OLD.matric_or_staff_id
     OR NEW.patient_category IS DISTINCT FROM OLD.patient_category
     OR NEW.faculty_or_unit IS DISTINCT FROM OLD.faculty_or_unit
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.is_walk_in IS DISTINCT FROM OLD.is_walk_in
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'Patients are not permitted to alter restricted institutional identity fields.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_appointments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_allow_cancel BOOLEAN;
  v_doc_id UUID;
BEGIN
  IF public.is_service_context() THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();
  IF v_role IN ('nurse', 'admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF v_role = 'patient' THEN
    SELECT allow_patient_cancellations INTO v_allow_cancel FROM public.system_settings LIMIT 1;
    IF COALESCE(v_allow_cancel, TRUE) = FALSE THEN
      RAISE EXCEPTION 'Patient appointment cancellations are currently disabled by clinic policy.';
    END IF;
    IF OLD.status NOT IN ('Booked', 'Approved', 'Rescheduled') OR NEW.status <> 'Cancelled' THEN
      RAISE EXCEPTION 'Patients may only cancel upcoming appointments that have not checked in.';
    END IF;
    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
       OR NEW.appointment_date IS DISTINCT FROM OLD.appointment_date
       OR NEW.appointment_time IS DISTINCT FROM OLD.appointment_time
       OR NEW.queue_number IS DISTINCT FROM OLD.queue_number
       OR NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
       OR NEW.checked_in_by IS DISTINCT FROM OLD.checked_in_by THEN
      RAISE EXCEPTION 'Patients cannot alter clinical scheduling or allocation fields.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role = 'doctor' THEN
    v_doc_id := public.get_my_doctor_id();
    IF OLD.doctor_id IS NOT NULL AND OLD.doctor_id IS DISTINCT FROM v_doc_id THEN
      RAISE EXCEPTION 'Appointment is assigned to another consultant doctor.';
    END IF;
    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.appointment_date IS DISTINCT FROM OLD.appointment_date
       OR NEW.appointment_time IS DISTINCT FROM OLD.appointment_time THEN
      RAISE EXCEPTION 'Doctors cannot alter core appointment scheduling metadata.';
    END IF;
    IF NEW.status NOT IN ('Checked In', 'Waiting', 'In Consultation', 'Completed') THEN
      RAISE EXCEPTION 'Invalid appointment status change by doctor.';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unauthorized role for appointment modification.';
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_lab_requests()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_service_context() THEN
    RETURN NEW;
  END IF;
  v_role := public.get_my_role();

  IF OLD.status = 'Reviewed' AND v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Reviewed laboratory reports are locked and cannot be modified.';
  END IF;

  IF v_role = 'lab' AND NEW.status = 'Reviewed' THEN
    RAISE EXCEPTION 'Only a consultant doctor or administrator may mark lab results as Reviewed.';
  END IF;

  IF v_role = 'doctor' THEN
    IF OLD.status <> 'Completed' OR NEW.status <> 'Reviewed' THEN
      RAISE EXCEPTION 'Doctors may only mark completed laboratory reports as Reviewed.';
    END IF;
    IF NEW.test_name IS DISTINCT FROM OLD.test_name
       OR NEW.test_category IS DISTINCT FROM OLD.test_category
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
      RAISE EXCEPTION 'Doctors cannot alter laboratory request metadata during review.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_lab_results()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_req_status TEXT;
BEGIN
  IF public.is_service_context() THEN
    RETURN NEW;
  END IF;
  v_role := public.get_my_role();

  SELECT status INTO v_req_status FROM public.laboratory_requests WHERE id = NEW.lab_request_id;
  IF TG_OP = 'UPDATE' AND v_req_status = 'Reviewed' AND v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Reviewed laboratory results are locked.';
  END IF;

  IF v_role = 'lab' THEN
    IF NEW.reviewed_by_doctor = TRUE OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Laboratory personnel cannot self-approve doctor review flags.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role = 'doctor' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Doctors cannot submit laboratory findings directly.';
    END IF;
    IF NEW.findings IS DISTINCT FROM OLD.findings
       OR NEW.numeric_value IS DISTINCT FROM OLD.numeric_value
       OR NEW.reference_range IS DISTINCT FROM OLD.reference_range
       OR NEW.interpretation IS DISTINCT FROM OLD.interpretation
       OR NEW.scientist_remarks IS DISTINCT FROM OLD.scientist_remarks
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by THEN
      RAISE EXCEPTION 'Doctors may not alter laboratory scientist diagnostic findings.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unauthorized role for laboratory result modification.';
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_prescriptions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_service_context() THEN
    RETURN NEW;
  END IF;
  v_role := public.get_my_role();
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Dispensed' THEN
    RAISE EXCEPTION 'Dispensed prescriptions cannot be modified.';
  END IF;
  IF NEW.prescription_code IS DISTINCT FROM OLD.prescription_code
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'Prescription header identity fields are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_prescription_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF NEW.quantity_dispensed < 0 OR NEW.quantity_dispensed > NEW.quantity_prescribed THEN
    RAISE EXCEPTION 'Dispensed quantity must be between 0 and prescribed quantity.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity_dispensed < OLD.quantity_dispensed THEN
    RAISE EXCEPTION 'Dispensed quantity cannot be decremented.';
  END IF;

  IF public.is_service_context() THEN
    RETURN NEW;
  END IF;
  v_role := public.get_my_role();
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_role = 'pharmacy' THEN
    IF NEW.prescription_id IS DISTINCT FROM OLD.prescription_id
       OR NEW.medication_id IS DISTINCT FROM OLD.medication_id
       OR NEW.medication_name IS DISTINCT FROM OLD.medication_name
       OR NEW.dosage IS DISTINCT FROM OLD.dosage
       OR NEW.frequency IS DISTINCT FROM OLD.frequency
       OR NEW.duration IS DISTINCT FROM OLD.duration
       OR NEW.quantity_prescribed IS DISTINCT FROM OLD.quantity_prescribed THEN
      RAISE EXCEPTION 'Pharmacy may only update dispensing quantity and availability status.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_protect_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_context() OR public.is_admin_or_super() THEN
    RETURN NEW;
  END IF;
  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.recipient_role IS DISTINCT FROM OLD.recipient_role
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id THEN
    RAISE EXCEPTION 'Only notification read status may be updated.';
  END IF;
  RETURN NEW;
END;
$$;

-- 10. Upgrade all 10 Transactional RPCs to support 'super_admin' (recording actor_role = 'super_admin')
--     and enforce Super Admin immutability + exclusive admin governance in rpc_admin_update_staff.

-- 10a. Register Walk-In Patient
CREATE OR REPLACE FUNCTION public.rpc_register_walk_in_patient(
  p_full_name TEXT,
  p_phone TEXT,
  p_gender TEXT DEFAULT 'Male',
  p_patient_category TEXT DEFAULT 'Student',
  p_matric_or_staff_id TEXT DEFAULT NULL,
  p_blood_group TEXT DEFAULT 'Unknown',
  p_allergies TEXT DEFAULT NULL
)
RETURNS public.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_actor_name TEXT;
  v_hosp_no TEXT;
  v_patient public.patients;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('nurse', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only nursing station staff or administrators may register walk-in patients.';
  END IF;
  IF NULLIF(TRIM(p_full_name), '') IS NULL OR NULLIF(TRIM(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Full name and phone number are required.';
  END IF;
  IF p_gender NOT IN ('Male', 'Female', 'Other') THEN
    RAISE EXCEPTION 'Invalid gender selection.';
  END IF;
  IF p_patient_category NOT IN ('Student', 'Staff', 'Dependent', 'Community') THEN
    RAISE EXCEPTION 'Invalid patient category selection.';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  LOOP
    v_hosp_no := 'FUDMA-HC-' || TO_CHAR(NOW(), 'YYMM') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.patients WHERE hospital_number = v_hosp_no);
  END LOOP;

  INSERT INTO public.patients (
    profile_id, hospital_number, matric_or_staff_id, patient_category,
    blood_group, genotype, allergies, is_walk_in,
    full_name, phone, gender
  ) VALUES (
    NULL, v_hosp_no, NULLIF(TRIM(p_matric_or_staff_id), ''), p_patient_category,
    COALESCE(NULLIF(TRIM(p_blood_group), ''), 'Unknown'), 'Unknown',
    NULLIF(TRIM(p_allergies), ''), TRUE,
    TRIM(p_full_name), TRIM(p_phone), p_gender
  )
  RETURNING * INTO v_patient;

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Staff'), v_role,
    'WALK_IN_PATIENT_REGISTERED', 'patient', v_hosp_no,
    'Walk-in patient ' || TRIM(p_full_name) || ' registered.'
  );

  RETURN v_patient;
END;
$$;

-- 10b. Atomic Appointment Booking
CREATE OR REPLACE FUNCTION public.rpc_book_appointment(
  p_patient_id UUID,
  p_department_id UUID,
  p_consultation_category TEXT,
  p_appointment_date DATE,
  p_appointment_time TEXT,
  p_reason TEXT,
  p_doctor_id UUID DEFAULT NULL,
  p_auto_check_in BOOLEAN DEFAULT FALSE
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_pat_id UUID;
  v_target_pat_id UUID;
  v_pat_name TEXT;
  v_actor_name TEXT;
  v_max_daily INTEGER;
  v_day_count INTEGER;
  v_code TEXT;
  v_queue INTEGER := NULL;
  v_status TEXT := 'Booked';
  v_checked_in_at TIMESTAMPTZ := NULL;
  v_checked_in_by UUID := NULL;
  v_appt public.appointments;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('patient', 'nurse', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to book appointments.';
  END IF;

  IF v_role = 'patient' THEN
    v_my_pat_id := public.get_my_patient_id();
    IF v_my_pat_id IS NULL THEN
      RAISE EXCEPTION 'Patient profile not found.';
    END IF;
    IF p_patient_id IS NOT NULL AND p_patient_id <> v_my_pat_id THEN
      RAISE EXCEPTION 'Patients may only book appointments for their own file.';
    END IF;
    v_target_pat_id := v_my_pat_id;
  ELSE
    v_target_pat_id := p_patient_id;
  END IF;

  SELECT COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_target_pat_id;

  IF v_pat_name IS NULL THEN
    RAISE EXCEPTION 'Selected patient not found.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Selected clinical department is invalid or inactive.';
  END IF;

  IF p_doctor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.doctors WHERE id = p_doctor_id AND is_available = TRUE
  ) THEN
    RAISE EXCEPTION 'Selected doctor is invalid or unavailable.';
  END IF;

  IF p_appointment_date IS NULL OR p_appointment_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Appointment date cannot be in the past.';
  END IF;

  IF p_appointment_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Invalid appointment time format (HH:MM).';
  END IF;

  IF v_role = 'patient' AND p_appointment_time NOT IN (
    '08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
    '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30'
  ) THEN
    RAISE EXCEPTION 'Please select a valid clinic consultation time slot (08:00 - 17:30).';
  END IF;

  IF NULLIF(TRIM(p_consultation_category), '') IS NULL OR NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Consultation category and reason are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fudma_appt_' || p_appointment_date::TEXT));

  SELECT COALESCE(max_daily_appointments, 120) INTO v_max_daily FROM public.system_settings LIMIT 1;
  SELECT COUNT(*) INTO v_day_count
  FROM public.appointments
  WHERE appointment_date = p_appointment_date AND status <> 'Cancelled';

  IF v_day_count >= v_max_daily THEN
    RAISE EXCEPTION 'Daily appointment capacity reached for this date. Please select another day.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments
    WHERE patient_id = v_target_pat_id
      AND appointment_date = p_appointment_date
      AND appointment_time = p_appointment_time
      AND status <> 'Cancelled'
  ) THEN
    RAISE EXCEPTION 'An active appointment already exists for this patient at the selected date and time.';
  END IF;

  IF p_auto_check_in = TRUE AND v_role IN ('nurse', 'admin', 'super_admin') THEN
    v_status := 'Checked In';
    v_checked_in_at := NOW();
    v_checked_in_by := v_uid;
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue
    FROM public.appointments
    WHERE appointment_date = p_appointment_date AND queue_number IS NOT NULL;
  END IF;

  LOOP
    v_code := 'APT-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.appointments WHERE appointment_code = v_code);
  END LOOP;

  INSERT INTO public.appointments (
    appointment_code, patient_id, department_id, doctor_id,
    consultation_category, appointment_date, appointment_time, reason,
    status, queue_number, checked_in_at, checked_in_by
  ) VALUES (
    v_code, v_target_pat_id, p_department_id, p_doctor_id,
    TRIM(p_consultation_category), p_appointment_date, p_appointment_time, TRIM(p_reason),
    v_status, v_queue, v_checked_in_at, v_checked_in_by
  )
  RETURNING * INTO v_appt;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notifications (recipient_role, title, message, category, reference_id)
  VALUES (
    'nurse',
    'New Appointment Scheduled',
    v_pat_name || ' booked ' || TRIM(p_consultation_category) || ' for ' || p_appointment_date::TEXT || ' at ' || p_appointment_time || '.',
    'appointment',
    v_appt.id
  );

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, v_pat_name), v_role,
    'APPOINTMENT_BOOKED', 'appointment', v_code,
    TRIM(p_consultation_category) || ' on ' || p_appointment_date::TEXT || ' ' || p_appointment_time
  );

  RETURN v_appt;
END;
$$;

-- 10c. Atomic Appointment Update
CREATE OR REPLACE FUNCTION public.rpc_update_appointment(
  p_appointment_id UUID,
  p_status TEXT DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL,
  p_update_doctor BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_pat_id UUID;
  v_my_doc_id UUID;
  v_appt public.appointments;
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_doc_profile_id UUID;
  v_actor_name TEXT;
  v_allow_cancel BOOLEAN;
  v_allowed_next TEXT[];
  v_next_queue INTEGER;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('patient', 'nurse', 'doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized to update appointment.';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fudma_appt_' || v_appt.appointment_date::TEXT));

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_appt.patient_id;

  IF v_role = 'patient' THEN
    v_my_pat_id := public.get_my_patient_id();
    IF v_appt.patient_id <> v_my_pat_id THEN
      RAISE EXCEPTION 'Forbidden: cannot modify another patient''s appointment.';
    END IF;
    SELECT COALESCE(allow_patient_cancellations, TRUE) INTO v_allow_cancel FROM public.system_settings LIMIT 1;
    IF NOT v_allow_cancel THEN
      RAISE EXCEPTION 'Self-service appointment cancellations are currently disabled by administration.';
    END IF;
    IF p_status IS DISTINCT FROM 'Cancelled' OR p_update_doctor = TRUE THEN
      RAISE EXCEPTION 'Patients may only cancel their own upcoming appointments.';
    END IF;
    IF v_appt.status NOT IN ('Booked', 'Approved', 'Rescheduled') THEN
      RAISE EXCEPTION 'Only un-checked-in appointments can be cancelled by the patient.';
    END IF;
  END IF;

  IF v_role = 'doctor' THEN
    v_my_doc_id := public.get_my_doctor_id();
    IF v_my_doc_id IS NULL THEN
      RAISE EXCEPTION 'Doctor profile is not linked.';
    END IF;
    IF v_appt.doctor_id IS NOT NULL AND v_appt.doctor_id <> v_my_doc_id THEN
      RAISE EXCEPTION 'This appointment is assigned to another consultant doctor.';
    END IF;
    IF p_update_doctor AND p_doctor_id IS DISTINCT FROM v_my_doc_id THEN
      RAISE EXCEPTION 'Doctors cannot reassign appointments to other doctors.';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('Checked In', 'Waiting', 'In Consultation', 'Completed') THEN
      RAISE EXCEPTION 'Doctors may only update appointments between clinical consultation stages.';
    END IF;
  END IF;

  IF p_status IS NOT NULL AND p_status <> v_appt.status THEN
    v_allowed_next := CASE v_appt.status
      WHEN 'Booked' THEN ARRAY['Approved', 'Checked In', 'Waiting', 'Cancelled', 'Rescheduled']
      WHEN 'Approved' THEN ARRAY['Checked In', 'Waiting', 'Cancelled', 'Rescheduled']
      WHEN 'Rescheduled' THEN ARRAY['Approved', 'Checked In', 'Waiting', 'Cancelled', 'Rescheduled']
      WHEN 'Checked In' THEN ARRAY['Waiting', 'In Consultation', 'Cancelled']
      WHEN 'Waiting' THEN ARRAY['In Consultation', 'Checked In', 'Cancelled']
      WHEN 'In Consultation' THEN ARRAY['Completed', 'Waiting']
      ELSE ARRAY[]::TEXT[]
    END;
    IF NOT (p_status = ANY(v_allowed_next)) THEN
      RAISE EXCEPTION 'Invalid appointment status transition from % to %.', v_appt.status, p_status;
    END IF;
  END IF;

  IF p_update_doctor THEN
    IF p_doctor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = p_doctor_id) THEN
      RAISE EXCEPTION 'Selected doctor does not exist.';
    END IF;
    v_appt.doctor_id := p_doctor_id;
    IF p_doctor_id IS NOT NULL THEN
      SELECT profile_id INTO v_doc_profile_id FROM public.doctors WHERE id = p_doctor_id;
      IF v_doc_profile_id IS NOT NULL THEN
        INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
        VALUES (
          v_doc_profile_id,
          'Patient Allocated to You',
          v_pat_name || ' (' || v_appt.appointment_code || ') has been assigned to your consultation queue.',
          'queue',
          v_appt.id
        );
      END IF;
    END IF;
  END IF;

  IF p_status IS NOT NULL THEN
    v_appt.status := p_status;
    IF v_role = 'doctor' AND p_status = 'In Consultation' AND v_appt.doctor_id IS NULL THEN
      v_appt.doctor_id := v_my_doc_id;
    END IF;
    IF p_status IN ('Checked In', 'Waiting') THEN
      IF v_appt.checked_in_at IS NULL THEN
        v_appt.checked_in_at := NOW();
        v_appt.checked_in_by := v_uid;
      END IF;
      IF v_appt.queue_number IS NULL THEN
        SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next_queue
        FROM public.appointments
        WHERE appointment_date = v_appt.appointment_date AND queue_number IS NOT NULL;
        v_appt.queue_number := v_next_queue;
      END IF;
    END IF;
  END IF;

  IF p_notes IS NOT NULL THEN
    v_appt.notes := NULLIF(TRIM(p_notes), '');
  END IF;

  UPDATE public.appointments
  SET
    doctor_id = v_appt.doctor_id,
    status = v_appt.status,
    queue_number = v_appt.queue_number,
    checked_in_at = v_appt.checked_in_at,
    checked_in_by = v_appt.checked_in_by,
    notes = v_appt.notes
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  IF p_status IS NOT NULL AND v_pat_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_pat_profile_id,
      'Appointment Status Updated',
      'Appointment ' || v_appt.appointment_code || ' is now "' || v_appt.status || '"' ||
        CASE WHEN v_appt.queue_number IS NOT NULL THEN ' (Queue #' || v_appt.queue_number || ')' ELSE '' END || '.',
      'appointment',
      v_appt.id
    );
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'User'), v_role,
    'APPOINTMENT_UPDATED', 'appointment', v_appt.appointment_code,
    'Status=' || v_appt.status || COALESCE(', Queue=#' || v_appt.queue_number::TEXT, '')
  );

  RETURN v_appt;
END;
$$;

-- 10d. Atomic Vital Signs Recording & Queue Promotion
CREATE OR REPLACE FUNCTION public.rpc_record_vitals_and_queue(
  p_appointment_id UUID,
  p_temperature_c NUMERIC DEFAULT NULL,
  p_blood_pressure TEXT DEFAULT NULL,
  p_pulse_bpm INTEGER DEFAULT NULL,
  p_respiratory_rate INTEGER DEFAULT NULL,
  p_spo2_percent INTEGER DEFAULT NULL,
  p_weight_kg NUMERIC DEFAULT NULL,
  p_height_cm NUMERIC DEFAULT NULL,
  p_priority TEXT DEFAULT 'Normal',
  p_doctor_id UUID DEFAULT NULL,
  p_triage_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_appt public.appointments;
  v_vital public.patient_vitals;
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_doc_profile_id UUID;
  v_actor_name TEXT;
  v_next_queue INTEGER;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('nurse', 'doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized to record vital signs.';
  END IF;

  IF p_priority NOT IN ('Normal', 'Urgent', 'Emergency') THEN
    RAISE EXCEPTION 'Invalid triage priority level.';
  END IF;
  IF p_temperature_c IS NOT NULL AND (p_temperature_c < 30 OR p_temperature_c > 45) THEN
    RAISE EXCEPTION 'Temperature (°C) must be between 30 and 45.';
  END IF;
  IF p_pulse_bpm IS NOT NULL AND (p_pulse_bpm < 25 OR p_pulse_bpm > 250) THEN
    RAISE EXCEPTION 'Pulse rate must be between 25 and 250 bpm.';
  END IF;
  IF p_spo2_percent IS NOT NULL AND (p_spo2_percent < 40 OR p_spo2_percent > 100) THEN
    RAISE EXCEPTION 'SpO2 percentage must be between 40 and 100.';
  END IF;
  IF p_weight_kg IS NOT NULL AND (p_weight_kg <= 0 OR p_weight_kg > 350) THEN
    RAISE EXCEPTION 'Weight (kg) must be greater than 0 and at most 350.';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found.';
  END IF;
  IF v_appt.status IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'Cannot record triage vitals for a % appointment.', v_appt.status;
  END IF;

  IF p_doctor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = p_doctor_id) THEN
    RAISE EXCEPTION 'Selected consultant doctor does not exist.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fudma_appt_' || v_appt.appointment_date::TEXT));

  INSERT INTO public.patient_vitals (
    appointment_id, patient_id, recorded_by,
    temperature_c, blood_pressure, pulse_bpm, respiratory_rate,
    spo2_percent, weight_kg, height_cm, triage_notes, priority
  ) VALUES (
    v_appt.id, v_appt.patient_id, v_uid,
    p_temperature_c, NULLIF(TRIM(p_blood_pressure), ''), p_pulse_bpm, p_respiratory_rate,
    p_spo2_percent, p_weight_kg, p_height_cm, NULLIF(TRIM(p_triage_notes), ''), p_priority
  )
  RETURNING * INTO v_vital;

  IF v_appt.queue_number IS NULL THEN
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next_queue
    FROM public.appointments
    WHERE appointment_date = v_appt.appointment_date AND queue_number IS NOT NULL;
    v_appt.queue_number := v_next_queue;
  END IF;

  UPDATE public.appointments
  SET
    status = 'Waiting',
    doctor_id = COALESCE(p_doctor_id, v_appt.doctor_id),
    queue_number = v_appt.queue_number,
    checked_in_at = COALESCE(v_appt.checked_in_at, NOW()),
    checked_in_by = COALESCE(v_appt.checked_in_by, v_uid)
  WHERE id = v_appt.id
  RETURNING * INTO v_appt;

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_appt.patient_id;

  IF v_appt.doctor_id IS NOT NULL THEN
    SELECT profile_id INTO v_doc_profile_id FROM public.doctors WHERE id = v_appt.doctor_id;
    IF v_doc_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
      VALUES (
        v_doc_profile_id,
        'Patient Ready for Consultation',
        v_pat_name || ' (Queue #' || COALESCE(v_appt.queue_number::TEXT, '-') || ') completed nursing triage (' || p_priority || ' priority).',
        'queue',
        v_appt.id
      );
    END IF;
  END IF;

  IF v_pat_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_pat_profile_id,
      'Triage Completed — Added to Queue',
      'Your vital signs have been recorded. Queue number: #' || COALESCE(v_appt.queue_number::TEXT, '-') || '.',
      'queue',
      v_appt.id
    );
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Nurse'), v_role,
    'VITALS_RECORDED', 'appointment', v_appt.appointment_code,
    'Vitals logged; patient queued (#' || COALESCE(v_appt.queue_number::TEXT, '-') || ', Priority: ' || p_priority || ').'
  );

  RETURN jsonb_build_object('vital', to_jsonb(v_vital), 'appointment', to_jsonb(v_appt));
END;
$$;

-- 10e. Atomic Consultation Upsert
CREATE OR REPLACE FUNCTION public.rpc_save_consultation(
  p_appointment_id UUID,
  p_chief_complaint TEXT,
  p_clinical_observations TEXT,
  p_diagnosis TEXT,
  p_treatment_plan TEXT DEFAULT NULL,
  p_follow_up_date DATE DEFAULT NULL,
  p_follow_up_notes TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'In Progress'
)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_doc_id UUID;
  v_doc_id UUID;
  v_appt public.appointments;
  v_con public.consultations;
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only consultant doctors or administrators may save consultations.';
  END IF;
  IF NULLIF(TRIM(p_chief_complaint), '') IS NULL
     OR NULLIF(TRIM(p_clinical_observations), '') IS NULL
     OR NULLIF(TRIM(p_diagnosis), '') IS NULL THEN
    RAISE EXCEPTION 'Chief complaint, clinical observations, and diagnosis are required.';
  END IF;
  IF p_status NOT IN ('In Progress', 'Awaiting Lab', 'Completed') THEN
    RAISE EXCEPTION 'Invalid consultation status.';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found.';
  END IF;
  IF v_appt.status NOT IN ('Checked In', 'Waiting', 'In Consultation', 'Completed') THEN
    RAISE EXCEPTION 'Cannot consult on an appointment in "%" status.', v_appt.status;
  END IF;

  v_my_doc_id := public.get_my_doctor_id();
  IF v_role = 'doctor' THEN
    IF v_my_doc_id IS NULL THEN
      RAISE EXCEPTION 'Consultant doctor profile is not linked.';
    END IF;
    IF v_appt.doctor_id IS NOT NULL AND v_appt.doctor_id <> v_my_doc_id THEN
      RAISE EXCEPTION 'This appointment is assigned to another consultant doctor.';
    END IF;
    v_doc_id := v_my_doc_id;
  ELSE
    v_doc_id := COALESCE(v_appt.doctor_id, v_my_doc_id);
    IF v_doc_id IS NULL THEN
      SELECT id INTO v_doc_id FROM public.doctors LIMIT 1;
    END IF;
    IF v_doc_id IS NULL THEN
      RAISE EXCEPTION 'No consultant doctor record is available to link this consultation.';
    END IF;
  END IF;

  SELECT * INTO v_con FROM public.consultations WHERE appointment_id = v_appt.id FOR UPDATE;
  IF FOUND THEN
    IF v_role = 'doctor' AND v_con.doctor_id <> v_doc_id THEN
      RAISE EXCEPTION 'Only the attending consultant doctor may update this consultation.';
    END IF;
    UPDATE public.consultations
    SET
      chief_complaint = TRIM(p_chief_complaint),
      clinical_observations = TRIM(p_clinical_observations),
      diagnosis = TRIM(p_diagnosis),
      treatment_plan = NULLIF(TRIM(p_treatment_plan), ''),
      follow_up_date = p_follow_up_date,
      follow_up_notes = NULLIF(TRIM(p_follow_up_notes), ''),
      status = p_status
    WHERE id = v_con.id
    RETURNING * INTO v_con;
  ELSE
    INSERT INTO public.consultations (
      appointment_id, patient_id, doctor_id,
      chief_complaint, clinical_observations, diagnosis,
      treatment_plan, follow_up_date, follow_up_notes, status
    ) VALUES (
      v_appt.id, v_appt.patient_id, v_doc_id,
      TRIM(p_chief_complaint), TRIM(p_clinical_observations), TRIM(p_diagnosis),
      NULLIF(TRIM(p_treatment_plan), ''), p_follow_up_date, NULLIF(TRIM(p_follow_up_notes), ''), p_status
    )
    RETURNING * INTO v_con;
  END IF;

  UPDATE public.appointments
  SET
    doctor_id = v_doc_id,
    status = CASE WHEN p_status = 'Completed' THEN 'Completed' ELSE 'In Consultation' END
  WHERE id = v_appt.id;

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_appt.patient_id;

  IF p_status = 'Completed' AND v_pat_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_pat_profile_id,
      'Consultation Completed',
      'Your consultation (' || v_appt.appointment_code || ') has been finalized. Review your visit summary and prescriptions.',
      'consultation',
      v_con.id
    );
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Doctor'), v_role,
    'CONSULTATION_SAVED', 'consultation', v_appt.appointment_code,
    'Diagnosis recorded for ' || v_pat_name || ' (' || p_status || ').'
  );

  RETURN v_con;
END;
$$;

-- 10f. Atomic Laboratory Request Creation
CREATE OR REPLACE FUNCTION public.rpc_create_lab_request(
  p_consultation_id UUID,
  p_test_name TEXT,
  p_test_category TEXT DEFAULT 'General Diagnostics',
  p_urgency TEXT DEFAULT 'Routine',
  p_clinical_notes TEXT DEFAULT NULL
)
RETURNS public.laboratory_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_doc_id UUID := public.get_my_doctor_id();
  v_con public.consultations;
  v_pat_name TEXT;
  v_actor_name TEXT;
  v_code TEXT;
  v_req public.laboratory_requests;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only consultant doctors or administrators may order laboratory tests.';
  END IF;
  IF NULLIF(TRIM(p_test_name), '') IS NULL THEN
    RAISE EXCEPTION 'Test name is required.';
  END IF;
  IF p_urgency NOT IN ('Routine', 'Urgent', 'Stat') THEN
    RAISE EXCEPTION 'Invalid test urgency selection.';
  END IF;

  SELECT * INTO v_con FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation not found.';
  END IF;
  IF v_role = 'doctor' AND (v_my_doc_id IS NULL OR v_con.doctor_id <> v_my_doc_id) THEN
    RAISE EXCEPTION 'Only the attending consultant doctor may order laboratory tests for this consultation.';
  END IF;

  LOOP
    v_code := 'LAB-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.laboratory_requests WHERE request_code = v_code);
  END LOOP;

  INSERT INTO public.laboratory_requests (
    request_code, consultation_id, patient_id, doctor_id,
    test_name, test_category, clinical_notes, urgency, status
  ) VALUES (
    v_code, v_con.id, v_con.patient_id, v_con.doctor_id,
    TRIM(p_test_name), COALESCE(NULLIF(TRIM(p_test_category), ''), 'General Diagnostics'),
    NULLIF(TRIM(p_clinical_notes), ''), p_urgency, 'Pending'
  )
  RETURNING * INTO v_req;

  SELECT COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_con.patient_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notifications (recipient_role, title, message, category, reference_id)
  VALUES (
    'lab',
    'New Laboratory Test Request',
    v_code || ': ' || TRIM(p_test_name) || ' ordered for ' || v_pat_name || ' (' || p_urgency || ').',
    'laboratory',
    v_req.id
  );

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Doctor'), v_role,
    'LAB_REQUEST_CREATED', 'laboratory_request', v_code,
    TRIM(p_test_name) || ' ordered for ' || v_pat_name || '.'
  );

  RETURN v_req;
END;
$$;

-- 10g. Atomic Laboratory Request & Result Update
CREATE OR REPLACE FUNCTION public.rpc_update_lab_request(
  p_lab_request_id UUID,
  p_status TEXT DEFAULT NULL,
  p_findings TEXT DEFAULT NULL,
  p_numeric_value TEXT DEFAULT NULL,
  p_reference_range TEXT DEFAULT NULL,
  p_interpretation TEXT DEFAULT 'Normal',
  p_scientist_remarks TEXT DEFAULT NULL
)
RETURNS public.laboratory_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_doc_id UUID := public.get_my_doctor_id();
  v_req public.laboratory_requests;
  v_allowed TEXT[];
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_doc_profile_id UUID;
  v_actor_name TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('lab', 'doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized to update laboratory requests.';
  END IF;

  SELECT * INTO v_req FROM public.laboratory_requests WHERE id = p_lab_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laboratory request not found.';
  END IF;

  IF p_interpretation IS NOT NULL AND p_interpretation NOT IN ('Normal', 'Abnormal', 'Critical') THEN
    RAISE EXCEPTION 'Invalid laboratory result interpretation.';
  END IF;

  IF p_status IS NOT NULL AND p_status <> v_req.status THEN
    v_allowed := CASE v_req.status
      WHEN 'Pending' THEN ARRAY['Sample Collected', 'Processing', 'Completed']
      WHEN 'Sample Collected' THEN ARRAY['Processing', 'Completed']
      WHEN 'Processing' THEN ARRAY['Completed']
      WHEN 'Completed' THEN ARRAY['Completed', 'Reviewed']
      ELSE ARRAY[]::TEXT[]
    END;
    IF NOT (p_status = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Invalid laboratory status transition from % to %.', v_req.status, p_status;
    END IF;
  END IF;

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_req.patient_id;

  SELECT profile_id INTO v_doc_profile_id FROM public.doctors WHERE id = v_req.doctor_id;
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  IF v_role = 'doctor' THEN
    IF v_my_doc_id IS NULL OR v_req.doctor_id <> v_my_doc_id THEN
      RAISE EXCEPTION 'Only the ordering consultant doctor may review this lab result.';
    END IF;
    IF p_status IS DISTINCT FROM 'Reviewed' OR NULLIF(TRIM(p_findings), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Doctors may only mark completed lab results as Reviewed.';
    END IF;
  END IF;

  IF v_role = 'lab' AND p_status = 'Reviewed' THEN
    RAISE EXCEPTION 'Only a consultant doctor or administrator may mark lab results as Reviewed.';
  END IF;

  IF p_status = 'Reviewed' THEN
    IF v_req.status <> 'Completed' THEN
      RAISE EXCEPTION 'Only completed laboratory requests may be marked as Reviewed.';
    END IF;
    UPDATE public.laboratory_requests SET status = 'Reviewed' WHERE id = v_req.id RETURNING * INTO v_req;
    UPDATE public.laboratory_results
    SET reviewed_by_doctor = TRUE, reviewed_at = NOW()
    WHERE lab_request_id = v_req.id;

    INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
    VALUES (
      v_uid, COALESCE(v_actor_name, 'Doctor'), v_role,
      'LAB_RESULT_REVIEWED', 'laboratory_request', v_req.request_code,
      v_req.test_name || ' reviewed by doctor.'
    );
    RETURN v_req;
  END IF;

  IF v_req.status = 'Reviewed' THEN
    RAISE EXCEPTION 'Reviewed laboratory reports are locked and cannot be modified.';
  END IF;
  IF p_status = 'Completed' AND NULLIF(TRIM(p_findings), '') IS NULL THEN
    RAISE EXCEPTION 'Diagnostic findings are required to complete a laboratory request.';
  END IF;

  IF NULLIF(TRIM(p_findings), '') IS NOT NULL THEN
    INSERT INTO public.laboratory_results (
      lab_request_id, recorded_by, findings, numeric_value, reference_range,
      interpretation, scientist_remarks, reviewed_by_doctor, reviewed_at
    ) VALUES (
      v_req.id, v_uid, TRIM(p_findings), NULLIF(TRIM(p_numeric_value), ''),
      NULLIF(TRIM(p_reference_range), ''), COALESCE(p_interpretation, 'Normal'),
      NULLIF(TRIM(p_scientist_remarks), ''), FALSE, NULL
    )
    ON CONFLICT (lab_request_id) DO UPDATE SET
      recorded_by = v_uid,
      findings = EXCLUDED.findings,
      numeric_value = EXCLUDED.numeric_value,
      reference_range = EXCLUDED.reference_range,
      interpretation = EXCLUDED.interpretation,
      scientist_remarks = EXCLUDED.scientist_remarks;

    UPDATE public.laboratory_requests
    SET status = 'Completed', assigned_lab_staff = v_uid
    WHERE id = v_req.id
    RETURNING * INTO v_req;

    IF v_doc_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
      VALUES (
        v_doc_profile_id,
        'Laboratory Result Submitted',
        v_req.request_code || ' (' || v_req.test_name || ') for ' || v_pat_name || ' is ready for review.',
        'laboratory',
        v_req.id
      );
    END IF;
    IF v_pat_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
      VALUES (
        v_pat_profile_id,
        'Lab Result Ready',
        'Results for ' || v_req.test_name || ' (' || v_req.request_code || ') have been submitted.',
        'laboratory',
        v_req.id
      );
    END IF;
  ELSIF p_status IS NOT NULL THEN
    UPDATE public.laboratory_requests
    SET status = p_status, assigned_lab_staff = v_uid
    WHERE id = v_req.id
    RETURNING * INTO v_req;
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Lab Scientist'), v_role,
    'LAB_REQUEST_UPDATED', 'laboratory_request', v_req.request_code,
    v_req.test_name || ' updated to ' || v_req.status || '.'
  );

  RETURN v_req;
END;
$$;

-- 10h. Atomic Prescription Creation
CREATE OR REPLACE FUNCTION public.rpc_create_prescription(
  p_consultation_id UUID,
  p_items JSONB
)
RETURNS public.prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_my_doc_id UUID := public.get_my_doctor_id();
  v_con public.consultations;
  v_rx public.prescriptions;
  v_code TEXT;
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_actor_name TEXT;
  v_item JSONB;
  v_med_id UUID;
  v_med_name TEXT;
  v_qty INTEGER;
  v_item_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('doctor', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only consultant doctors or administrators may create prescriptions.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one prescription medication item is required.';
  END IF;

  SELECT * INTO v_con FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation record not found.';
  END IF;
  IF v_role = 'doctor' AND (v_my_doc_id IS NULL OR v_con.doctor_id <> v_my_doc_id) THEN
    RAISE EXCEPTION 'Only the attending consultant doctor may prescribe for this consultation.';
  END IF;

  LOOP
    v_code := 'RX-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.prescriptions WHERE prescription_code = v_code);
  END LOOP;

  INSERT INTO public.prescriptions (
    prescription_code, consultation_id, patient_id, doctor_id, status
  ) VALUES (
    v_code, v_con.id, v_con.patient_id, v_con.doctor_id, 'Pending'
  )
  RETURNING * INTO v_rx;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((v_item->>'quantity_prescribed')::INTEGER, 0);
    IF v_qty <= 0 OR v_qty > 1000 THEN
      RAISE EXCEPTION 'Prescribed quantity must be a positive integer between 1 and 1000.';
    END IF;

    v_med_id := NULLIF(TRIM(v_item->>'medication_id'), '')::UUID;
    IF v_med_id IS NOT NULL THEN
      SELECT name INTO v_med_name FROM public.medications WHERE id = v_med_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected medication item does not exist in inventory.';
      END IF;
    ELSE
      v_med_name := COALESCE(NULLIF(TRIM(v_item->>'medication_name'), ''), 'Prescribed Medication');
    END IF;

    INSERT INTO public.prescription_items (
      prescription_id, medication_id, medication_name,
      dosage, frequency, duration, quantity_prescribed,
      quantity_dispensed, availability_status, instructions
    ) VALUES (
      v_rx.id,
      v_med_id,
      v_med_name,
      COALESCE(NULLIF(TRIM(v_item->>'dosage'), ''), 'As directed'),
      COALESCE(NULLIF(TRIM(v_item->>'frequency'), ''), 'Daily'),
      COALESCE(NULLIF(TRIM(v_item->>'duration'), ''), '5 days'),
      v_qty,
      0,
      'Pending',
      NULLIF(TRIM(v_item->>'instructions'), '')
    );
    v_item_count := v_item_count + 1;
  END LOOP;

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_con.patient_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notifications (recipient_role, title, message, category, reference_id)
  VALUES (
    'pharmacy',
    'New Prescription Issued',
    'Prescription ' || v_code || ' issued for ' || v_pat_name || ' (' || v_item_count || ' medication item(s)).',
    'pharmacy',
    v_rx.id
  );

  IF v_pat_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_pat_profile_id,
      'New Prescription Issued',
      'Your doctor issued prescription ' || v_code || '. Proceed to the Pharmacy Dispensary once notified.',
      'pharmacy',
      v_rx.id
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Doctor'), v_role,
    'PRESCRIPTION_ISSUED', 'prescription', v_code,
    'Issued ' || v_item_count || ' item(s) for ' || v_pat_name || '.'
  );

  RETURN v_rx;
END;
$$;

-- 10i. Atomic Pharmacy Dispensing & Stock Deduction
CREATE OR REPLACE FUNCTION public.rpc_dispense_prescription(
  p_prescription_id UUID,
  p_status TEXT DEFAULT NULL,
  p_pharmacist_notes TEXT DEFAULT NULL,
  p_item_updates JSONB DEFAULT NULL
)
RETURNS public.prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_rx public.prescriptions;
  v_allowed TEXT[];
  v_item public.prescription_items;
  v_upd JSONB;
  v_new_disp INTEGER;
  v_delta INTEGER;
  v_total_delta INTEGER := 0;
  v_med public.medications;
  v_pat_profile_id UUID;
  v_pat_name TEXT;
  v_doc_profile_id UUID;
  v_actor_name TEXT;
  v_next_status TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('pharmacy', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only pharmacy personnel or administrators may dispense prescriptions.';
  END IF;

  SELECT * INTO v_rx FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prescription not found.';
  END IF;

  IF v_rx.status = 'Dispensed' THEN
    RAISE EXCEPTION 'Prescription has already been fully dispensed and cannot be altered.';
  END IF;

  v_next_status := COALESCE(p_status, v_rx.status);
  IF v_next_status <> v_rx.status THEN
    v_allowed := CASE v_rx.status
      WHEN 'Pending' THEN ARRAY['Available', 'Partially Dispensed', 'Dispensed', 'Unavailable']
      WHEN 'Available' THEN ARRAY['Partially Dispensed', 'Dispensed', 'Unavailable']
      WHEN 'Partially Dispensed' THEN ARRAY['Available', 'Partially Dispensed', 'Dispensed', 'Unavailable']
      WHEN 'Unavailable' THEN ARRAY['Available', 'Partially Dispensed', 'Dispensed']
      ELSE ARRAY[]::TEXT[]
    END;
    IF NOT (v_next_status = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Invalid prescription status transition from % to %.', v_rx.status, v_next_status;
    END IF;
  END IF;

  FOR v_item IN
    SELECT * FROM public.prescription_items
    WHERE prescription_id = v_rx.id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_new_disp := v_item.quantity_dispensed;

    IF p_item_updates IS NOT NULL AND jsonb_typeof(p_item_updates) = 'array' AND jsonb_array_length(p_item_updates) > 0 THEN
      SELECT elem INTO v_upd
      FROM jsonb_array_elements(p_item_updates) elem
      WHERE (elem->>'id')::UUID = v_item.id
      LIMIT 1;

      IF v_upd IS NOT NULL AND v_upd ? 'quantity_dispensed' THEN
        v_new_disp := (v_upd->>'quantity_dispensed')::INTEGER;
      END IF;
    ELSIF v_next_status = 'Dispensed' THEN
      v_new_disp := v_item.quantity_prescribed;
    ELSIF v_next_status = 'Partially Dispensed' THEN
      IF v_item.quantity_prescribed > v_item.quantity_dispensed THEN
        IF v_item.medication_id IS NOT NULL THEN
          SELECT * INTO v_med FROM public.medications WHERE id = v_item.medication_id FOR UPDATE;
          v_new_disp := v_item.quantity_dispensed + LEAST(v_item.quantity_prescribed - v_item.quantity_dispensed, COALESCE(v_med.stock_quantity, 0));
        ELSE
          v_new_disp := v_item.quantity_prescribed;
        END IF;
      END IF;
    END IF;

    IF v_new_disp < 0 OR v_new_disp > v_item.quantity_prescribed THEN
      RAISE EXCEPTION 'Invalid dispensing quantity (%) for % (prescribed: %).', v_new_disp, v_item.medication_name, v_item.quantity_prescribed;
    END IF;
    IF v_new_disp < v_item.quantity_dispensed THEN
      RAISE EXCEPTION 'Cannot reduce already-dispensed quantity for %.', v_item.medication_name;
    END IF;

    v_delta := v_new_disp - v_item.quantity_dispensed;

    IF v_delta > 0 AND v_item.medication_id IS NOT NULL THEN
      SELECT * INTO v_med FROM public.medications WHERE id = v_item.medication_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Medication record missing for %.', v_item.medication_name;
      END IF;
      IF v_med.stock_quantity < v_delta THEN
        RAISE EXCEPTION 'Insufficient stock for %: requested %, available %.', v_med.name, v_delta, v_med.stock_quantity;
      END IF;

      UPDATE public.medications
      SET stock_quantity = stock_quantity - v_delta
      WHERE id = v_med.id
      RETURNING * INTO v_med;

      IF v_med.stock_quantity <= v_med.reorder_level THEN
        INSERT INTO public.notifications (recipient_role, title, message, category, reference_id)
        VALUES (
          'pharmacy',
          'Low Medication Stock Alert',
          v_med.name || ' stock dropped to ' || v_med.stock_quantity || ' ' || v_med.unit_label || ' (reorder level: ' || v_med.reorder_level || ').',
          'pharmacy',
          v_med.id
        );
      END IF;
    END IF;

    v_total_delta := v_total_delta + v_delta;

    UPDATE public.prescription_items
    SET
      quantity_dispensed = v_new_disp,
      availability_status = CASE
        WHEN v_next_status = 'Unavailable' AND v_new_disp = 0 THEN 'Unavailable'
        WHEN v_new_disp >= v_item.quantity_prescribed THEN 'Dispensed'
        WHEN v_new_disp > 0 OR v_next_status = 'Available' THEN 'Available'
        ELSE availability_status
      END
    WHERE id = v_item.id;
  END LOOP;

  IF p_status = 'Dispensed' AND EXISTS (
    SELECT 1 FROM public.prescription_items
    WHERE prescription_id = v_rx.id AND quantity_dispensed < quantity_prescribed
  ) THEN
    RAISE EXCEPTION 'Cannot mark prescription Dispensed until all prescribed quantities are dispensed.';
  END IF;

  IF v_next_status = 'Partially Dispensed' AND NOT EXISTS (
    SELECT 1 FROM public.prescription_items
    WHERE prescription_id = v_rx.id AND quantity_dispensed > 0
  ) THEN
    RAISE EXCEPTION 'No medication stock is available to partially dispense. Mark as Unavailable instead.';
  END IF;

  UPDATE public.prescriptions
  SET
    status = v_next_status,
    pharmacist_notes = COALESCE(NULLIF(TRIM(p_pharmacist_notes), ''), pharmacist_notes)
  WHERE id = v_rx.id
  RETURNING * INTO v_rx;

  IF (v_total_delta > 0 OR v_next_status IN ('Dispensed', 'Partially Dispensed'))
     AND NOT (v_total_delta = 0 AND v_rx.status = 'Partially Dispensed' AND p_status = 'Partially Dispensed'
              AND EXISTS (SELECT 1 FROM public.pharmacy_dispensing WHERE prescription_id = v_rx.id)) THEN
    INSERT INTO public.pharmacy_dispensing (prescription_id, dispensed_by, dispensed_notes, dispensed_at)
    VALUES (
      v_rx.id, v_uid,
      COALESCE(NULLIF(TRIM(p_pharmacist_notes), ''), 'Status: ' || v_next_status),
      NOW()
    );
  END IF;

  SELECT pt.profile_id, COALESCE(pt.full_name, pr.full_name, 'Patient')
  INTO v_pat_profile_id, v_pat_name
  FROM public.patients pt
  LEFT JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.id = v_rx.patient_id;

  SELECT profile_id INTO v_doc_profile_id FROM public.doctors WHERE id = v_rx.doctor_id;
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  IF v_pat_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_pat_profile_id,
      'Pharmacy Update: ' || v_next_status,
      'Prescription ' || v_rx.prescription_code || ' is marked "' || v_next_status || '".',
      'pharmacy',
      v_rx.id
    );
  END IF;

  IF v_next_status = 'Unavailable' AND v_doc_profile_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, title, message, category, reference_id)
    VALUES (
      v_doc_profile_id,
      'Prescribed Medication Unavailable',
      v_rx.prescription_code || ' for ' || v_pat_name || ' was marked Unavailable by Pharmacy.',
      'pharmacy',
      v_rx.id
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Pharmacist'), v_role,
    'PRESCRIPTION_' || UPPER(REPLACE(v_next_status, ' ', '_')),
    'prescription', v_rx.prescription_code,
    'Updated to ' || v_next_status || ' for ' || v_pat_name || ' (Units dispensed: ' || v_total_delta || ').'
  );

  RETURN v_rx;
END;
$$;

-- 10j. Staff Role / Activation Update (Enforces Super Admin immutability & exclusive admin governance)
CREATE OR REPLACE FUNCTION public.rpc_admin_update_staff(
  p_target_user_id UUID,
  p_role TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := public.get_my_role();
  v_target_prof public.profiles;
  v_target_role TEXT;
  v_actor_name TEXT;
  v_dept_id UUID;
  v_staff_code TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only System Administrators or Super Administrators may modify staff accounts.';
  END IF;

  SELECT * INTO v_target_prof FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff account not found.';
  END IF;

  SELECT role INTO v_target_role FROM public.user_roles WHERE user_id = p_target_user_id;

  IF v_target_role = 'super_admin' OR public.is_protected_super_admin(p_target_user_id) THEN
    RAISE EXCEPTION 'The Super Admin account is protected and cannot be modified, suspended, demoted, or deleted.';
  END IF;

  IF p_role = 'super_admin' THEN
    RAISE EXCEPTION 'Super Admin privileges cannot be assigned through staff management.';
  END IF;

  IF (v_target_role = 'admin' OR p_role = 'admin') AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the Super Administrator may assign, modify, or suspend administrator accounts.';
  END IF;

  IF p_target_user_id = v_uid AND p_is_active = FALSE THEN
    RAISE EXCEPTION 'Administrators cannot deactivate their own active account.';
  END IF;
  IF p_target_user_id = v_uid AND p_role IS NOT NULL AND p_role <> v_role THEN
    RAISE EXCEPTION 'Administrators cannot remove their own administrator role.';
  END IF;

  IF p_role IS NOT NULL THEN
    IF p_role NOT IN ('nurse', 'lab', 'pharmacy', 'doctor', 'admin') THEN
      RAISE EXCEPTION 'Invalid staff role.';
    END IF;
    UPDATE public.user_roles
    SET role = p_role, assigned_by = v_uid
    WHERE user_id = p_target_user_id;

    IF p_role = 'doctor' AND NOT EXISTS (SELECT 1 FROM public.doctors WHERE profile_id = p_target_user_id) THEN
      SELECT id INTO v_dept_id FROM public.departments WHERE is_active = TRUE ORDER BY created_at LIMIT 1;
      IF v_dept_id IS NULL THEN
        SELECT id INTO v_dept_id FROM public.departments ORDER BY created_at LIMIT 1;
      END IF;
      IF v_dept_id IS NOT NULL THEN
        v_staff_code := 'DOC-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4));
        INSERT INTO public.doctors (profile_id, department_id, staff_code, specialization, consultation_room, is_available)
        VALUES (p_target_user_id, v_dept_id, v_staff_code, 'General Outpatient Medicine', 'Consult Room', TRUE);
      END IF;
    END IF;
  END IF;

  IF p_is_active IS NOT NULL THEN
    UPDATE public.profiles SET is_active = p_is_active WHERE id = p_target_user_id;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.activity_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_uid, COALESCE(v_actor_name, 'Admin'), v_role,
    'STAFF_ACCOUNT_UPDATED', 'profile', v_target_prof.email,
    'Updated account for ' || v_target_prof.full_name || '.'
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
