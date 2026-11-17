-- =============================================================================
-- FUDMA HEALTHCENTER: Group 11 Approved Student Whitelist & Enforcement
-- Migration: 005_group11_whitelist.sql
-- Purpose: Database-enforced onboarding restriction for Group 11 academic project
-- Safe to run after 001_schema.sql, 002_rls_policies.sql, 003_seed_data.sql, 004_rpc_and_hardening.sql
-- =============================================================================

-- 1. Canonical matriculation number normalizer (uppercase, trimmed, no whitespace)
CREATE OR REPLACE FUNCTION public.normalize_matric_number(p_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_input, '')), '\s+', '', 'g'));
$$;

-- 2. Group 11 approved student whitelist table
CREATE TABLE IF NOT EXISTS public.group11_student_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  matric_number TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  is_registered BOOLEAN NOT NULL DEFAULT FALSE,
  registered_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_at TIMESTAMPTZ,
  CONSTRAINT chk_group11_matric_normalized
    CHECK (matric_number = public.normalize_matric_number(matric_number) AND LENGTH(matric_number) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group11_whitelist_norm_matric
  ON public.group11_student_whitelist (public.normalize_matric_number(matric_number));

-- 3. Seed strictly the 5 approved Group 11 students (exact project whitelist)
INSERT INTO public.group11_student_whitelist (full_name, matric_number, department)
VALUES
  ('SALISU ABUBAKAR BAKORI', 'ENG/2024/32094', 'Civil Engineering'),
  ('ABDULHAKEEM FARUK OLANIYI', 'ENG/2024/31802', 'Mechanical Engineering'),
  ('ALI EZEKIEL ENEOJO', 'ENG/2024/31820', 'Civil Engineering'),
  ('MUHAMMAD RAJI ABDULMUHAIMIN', 'ENG/2024/31747', 'Mechatronics Engineering'),
  ('MOHAMMED MANDAJUMA IBRAHIM', 'ENG/2024/31911', 'Mechanical Engineering')
ON CONFLICT (matric_number) DO NOTHING;

-- 4. Lock down whitelist table with strict RLS (never publicly readable as a list)
ALTER TABLE public.group11_student_whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view all whitelist records" ON public.group11_student_whitelist;
CREATE POLICY "Admins view all whitelist records"
  ON public.group11_student_whitelist FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Students view own whitelist claim" ON public.group11_student_whitelist;
CREATE POLICY "Students view own whitelist claim"
  ON public.group11_student_whitelist FOR SELECT
  USING (registered_user_id = auth.uid());

-- 5. Safe Step-1 verification RPC (returns ONLY single matched unclaimed student; never exposes full whitelist)
CREATE OR REPLACE FUNCTION public.rpc_verify_group11_matric(p_matric_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_wl RECORD;
BEGIN
  v_norm := public.normalize_matric_number(p_matric_number);

  IF v_norm = '' OR v_norm !~ '^[A-Z0-9]+/[0-9]{4}/[0-9]+$' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'INVALID_FORMAT',
      'message', 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.'
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

-- 6. Replace handle_new_user() trigger so EVERY public signup (UI or direct API)
--    is strictly verified, row-locked (FOR UPDATE), and atomically claimed on the whitelist.
--    Admin-provisioned staff accounts carry raw_app_meta_data->>'account_origin' = 'admin_staff'
--    (which can only be set by service_role Admin API, never public client signUp).
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

  IF v_account_origin = 'admin_staff' THEN
    -- Admin-provisioned staff account via /api/admin/staff (service_role only)
    v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));

    INSERT INTO public.profiles (id, full_name, email, phone, gender, date_of_birth, address)
    VALUES (NEW.id, v_full_name, NEW.email, v_phone, v_gender, v_dob, v_address)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'patient')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Public patient registration MUST match an unclaimed Group 11 whitelist record
  v_norm_matric := public.normalize_matric_number(NEW.raw_user_meta_data->>'matric_or_staff_id');
  IF v_norm_matric = '' THEN
    RAISE EXCEPTION 'Access Denied. Your matriculation number is not authorised for Group 11 registration. Please contact your project administrator.';
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

  -- Enforce canonical verified student identity from database whitelist (ignores tampered client metadata)
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

  -- Security invariant: Public self-registration ALWAYS receives 'patient'
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

  -- Atomically mark whitelist entry as claimed by this auth user
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

-- 7. Strengthen profile & patient triggers so verified students cannot tamper with full_name post-registration
CREATE OR REPLACE FUNCTION public.trg_fn_protect_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_context() OR public.get_my_role() = 'admin' THEN
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

CREATE OR REPLACE FUNCTION public.trg_fn_protect_patients()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_context() OR public.get_my_role() IN ('nurse', 'admin') THEN
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
