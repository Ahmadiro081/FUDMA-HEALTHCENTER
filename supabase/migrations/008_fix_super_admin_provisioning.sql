-- =============================================================================
-- FUDMA HEALTHCENTER: Super Admin Provisioning & Trigger Repair Migration
-- Migration: 008_fix_super_admin_provisioning.sql
-- Purpose:
--   1. Idempotently ensure normalize_matric_number, user_roles & notifications
--      CHECK constraints, and privileged_accounts registry exist cleanly
--   2. Ensure public.is_service_context() stays SECURITY INVOKER (never SECURITY DEFINER)
--   3. Repair public.handle_new_user() and protection triggers so GoTrue
--      auth.admin.createUser() succeeds cleanly without trigger blocks
--   4. Output diagnostic status at the end when executed in Supabase SQL Editor
-- Safe & idempotent to run after 001..007 migrations.
-- =============================================================================

-- 0. Ensure canonical matriculation number normalizer exists
CREATE OR REPLACE FUNCTION public.normalize_matric_number(p_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_input, '')), '\s+', '', 'g'));
$$;

-- 1. Ensure user_roles allows 'super_admin' & single super_admin uniqueness
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

-- 2. Ensure notifications.recipient_role allows 'super_admin'
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

-- 3. Keep is_service_context() strictly SECURITY INVOKER so authenticated callers never spoof postgres
CREATE OR REPLACE FUNCTION public.is_service_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
      OR current_user IN ('postgres', 'supabase_admin');
$$;

-- 4. Ensure privileged_accounts table & immutability helpers exist
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

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role(), '') = 'super_admin';
$$;

-- 5. Ensure user_roles protection trigger allows server-side service_role and initial 'patient' inserts
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

-- 6. Repair handle_new_user() so server-side Admin API provisioning never fails inside GoTrue
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
  v_initial_role TEXT;
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

  IF v_account_origin IN ('admin_staff', 'admin_student', 'super_admin_provision') THEN
    IF v_account_origin = 'super_admin_provision' AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Initial Super Administrator has already been provisioned and cannot be duplicated.';
    END IF;

    v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));

    INSERT INTO public.profiles (id, full_name, email, phone, gender, date_of_birth, address)
    VALUES (NEW.id, v_full_name, LOWER(NEW.email), v_phone, v_gender, v_dob, v_address)
    ON CONFLICT (id) DO NOTHING;

    v_initial_role := CASE
      WHEN v_account_origin = 'super_admin_provision' AND public.is_service_context() THEN 'super_admin'
      ELSE 'patient'
    END;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_initial_role)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Public patient registration MUST match an unclaimed Group 11 whitelist record
  v_norm_matric := public.normalize_matric_number(NEW.raw_user_meta_data->>'matric_or_staff_id');
  IF v_norm_matric = '' THEN
    RAISE EXCEPTION 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.';
  END IF;

  IF v_norm_matric = 'ENG/2012/0001' OR EXISTS (
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
  VALUES (NEW.id, v_full_name, LOWER(NEW.email), v_phone, v_gender, v_dob, v_address)
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
    LOWER(NEW.email),
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Diagnostic verification summary (displayed in Supabase SQL Editor)
SELECT
  (SELECT COUNT(*) FROM auth.users WHERE LOWER(email) = 'ahmadcybro@gmail.com') AS auth_users_for_email,
  (SELECT COUNT(*) FROM public.profiles WHERE LOWER(email) = 'ahmadcybro@gmail.com') AS profiles_for_email,
  (SELECT COUNT(*) FROM public.user_roles WHERE role = 'super_admin') AS super_admin_roles,
  (SELECT COUNT(*) FROM public.privileged_accounts) AS privileged_accounts,
  (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace) AS handle_new_user_owner,
  (SELECT string_agg(t.tgname, ', ')
   FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal) AS auth_users_triggers;
