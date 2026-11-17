-- =============================================================================
-- FUDMA HEALTHCENTER: Provisioning-Intent Security & Super Admin Identity Update
-- Migration: 009_super_admin_provisioning_intent.sql
-- Purpose:
--   1. Introduce server-authorized single-use public.provisioning_intents table
--      (SHA-256 token verification via extensions.digest) so GoTrue's
--      auth.admin.createUser() never fails inside handle_new_user()
--   2. Designate ENG/2011/0001 and i.ahmad22044@fudutsinma.edu.ng as the
--      first Initial Super Administrator identity
--   3. Preserve idx_user_roles_single_super_admin, all RLS policies, all
--      protection triggers, and complete Group 11 public signup enforcement
-- Safe & idempotent to run after 001..008 migrations.
-- =============================================================================

-- 1. Server-only single-use provisioning intents table (zero public access)
CREATE TABLE IF NOT EXISTS public.provisioning_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  account_origin TEXT NOT NULL CHECK (account_origin IN ('super_admin_provision', 'admin_staff', 'admin_student')),
  target_email TEXT NOT NULL,
  target_username TEXT NULL,
  intended_role TEXT NOT NULL CHECK (intended_role IN ('super_admin', 'patient', 'nurse', 'lab', 'pharmacy', 'doctor', 'admin')),
  issued_by UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  consumed_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_provisioning_intent_email_lower
    CHECK (target_email = LOWER(TRIM(target_email)) AND LENGTH(target_email) > 3),
  CONSTRAINT chk_provisioning_intent_super_admin_identity
    CHECK (
      account_origin <> 'super_admin_provision' OR (
        target_email = 'i.ahmad22044@fudutsinma.edu.ng'
        AND public.normalize_matric_number(target_username) = 'ENG/2011/0001'
        AND intended_role = 'super_admin'
        AND issued_by IS NULL
      )
    ),
  CONSTRAINT chk_provisioning_intent_admin_issuer
    CHECK (
      account_origin NOT IN ('admin_staff', 'admin_student') OR issued_by IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_provisioning_intents_lookup
  ON public.provisioning_intents (token_hash, target_email)
  WHERE consumed_at IS NULL;

ALTER TABLE public.provisioning_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provisioning_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.provisioning_intents TO service_role;

-- 2. Protect Group 11 whitelist against ENG/2011/0001 & any privileged_accounts username
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

-- 3. Update Step-1 matriculation verification RPC for ENG/2011/0001
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
          'ENG/2011/0001 is the designated Initial Super Administrator identity and has already been provisioned. Please sign in through /admin-login with your credentials.'
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

-- 4. Update handle_new_user() trigger to validate single-use SHA-256 provisioning intents
--    while preserving complete Group 11 student registration enforcement
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  generated_hosp_no TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_intent RECORD;
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

  v_raw_token := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'provisioning_intent_token', '')), '');

  IF v_raw_token IS NOT NULL THEN
    v_token_hash := encode(extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');

    SELECT *
    INTO v_intent
    FROM public.provisioning_intents
    WHERE token_hash = v_token_hash
      AND target_email = LOWER(TRIM(COALESCE(NEW.email, '')))
      AND consumed_at IS NULL
      AND expires_at > NOW()
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access Denied. Invalid, expired, or already-used provisioning intent token.';
    END IF;

    IF v_intent.account_origin = 'super_admin_provision' THEN
      IF LOWER(TRIM(COALESCE(NEW.email, ''))) <> 'i.ahmad22044@fudutsinma.edu.ng' THEN
        RAISE EXCEPTION 'Initial Super Administrator email does not match designated identity.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin')
         OR EXISTS (SELECT 1 FROM public.privileged_accounts) THEN
        RAISE EXCEPTION 'Initial Super Administrator has already been provisioned and cannot be duplicated.';
      END IF;
    END IF;

    UPDATE public.provisioning_intents
    SET
      consumed_at = NOW(),
      consumed_user_id = NEW.id
    WHERE id = v_intent.id;

    v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));

    INSERT INTO public.profiles (id, full_name, email, phone, gender, date_of_birth, address)
    VALUES (NEW.id, v_full_name, LOWER(NEW.email), v_phone, v_gender, v_dob, v_address)
    ON CONFLICT (id) DO NOTHING;

    v_initial_role := CASE
      WHEN v_intent.account_origin = 'super_admin_provision' THEN 'super_admin'
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

-- 5. Update atomic service_role-only Super Admin finalizer for ENG/2011/0001 + i.ahmad22044@fudutsinma.edu.ng
CREATE OR REPLACE FUNCTION public.rpc_finalize_super_admin_provision(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_login_username TEXT DEFAULT 'ENG/2011/0001',
  p_account_type TEXT DEFAULT 'Privileged Administrative Account'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_username TEXT := public.normalize_matric_number(p_login_username);
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
  v_full_name TEXT := TRIM(COALESCE(p_full_name, ''));
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'Forbidden: Super Admin provisioning requires server-side service_role context.';
  END IF;

  IF p_user_id IS NULL OR v_full_name = '' OR v_email = '' THEN
    RAISE EXCEPTION 'User ID, full name, and email are required for Super Admin provisioning.';
  END IF;

  IF v_norm_username <> 'ENG/2011/0001' THEN
    RAISE EXCEPTION 'Initial Super Admin login username is restricted exclusively to ENG/2011/0001.';
  END IF;

  IF v_email <> 'i.ahmad22044@fudutsinma.edu.ng' THEN
    RAISE EXCEPTION 'Initial Super Admin email is restricted exclusively to i.ahmad22044@fudutsinma.edu.ng.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fudma_super_admin_provision'));

  IF NOT EXISTS (
    SELECT 1 FROM public.provisioning_intents
    WHERE account_origin = 'super_admin_provision'
      AND consumed_user_id = p_user_id
      AND target_email = v_email
      AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Missing verified Super Admin provisioning intent for this user.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.privileged_accounts)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin' AND user_id <> p_user_id) THEN
    RAISE EXCEPTION 'Super Admin (ENG/2011/0001) has already been provisioned and cannot be duplicated.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE LOWER(email) = v_email AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Email % belongs to an existing account and cannot be overwritten.', v_email;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group11_student_whitelist
    WHERE public.normalize_matric_number(matric_number) = v_norm_username
  ) THEN
    RAISE EXCEPTION 'ENG/2011/0001 must never exist in group11_student_whitelist.';
  END IF;

  DELETE FROM public.patients WHERE profile_id = p_user_id;

  INSERT INTO public.profiles (id, full_name, email, phone, address, is_active)
  VALUES (
    p_user_id,
    v_full_name,
    v_email,
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    'FUDMA Healthcenter Executive Administration',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    is_active = TRUE;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (p_user_id, 'super_admin', p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'super_admin',
    assigned_by = p_user_id;

  INSERT INTO public.privileged_accounts (
    user_id, login_username, role, account_type, is_immutable
  )
  VALUES (
    p_user_id,
    v_norm_username,
    'super_admin',
    COALESCE(NULLIF(TRIM(p_account_type), ''), 'Privileged Administrative Account'),
    TRUE
  );

  INSERT INTO public.activity_logs (
    actor_id, actor_name, actor_role, action, entity_type, entity_id, details
  )
  VALUES (
    p_user_id,
    v_full_name,
    'super_admin',
    'SUPER_ADMIN_PROVISIONED',
    'privileged_account',
    v_norm_username,
    'Initial Privileged Administrative Account (' || v_norm_username || ') provisioned atomically via server-side intent workflow.'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'user_id', p_user_id,
    'login_username', v_norm_username,
    'role', 'super_admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_finalize_super_admin_provision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_super_admin_provision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
