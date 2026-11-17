-- =============================================================================
-- FUDMA HEALTHCENTER: Admin-Provisioned Student Synchronization
-- Migration: 007_admin_student_provisioning.sql
-- Purpose:
--   1. Allow server-side Admin student provisioning ('admin_student' origin)
--      alongside 'admin_staff' and 'super_admin_provision' in handle_new_user()
--   2. Preserve strict Group 11 enforcement on all public client self-signups
--   3. Allow active admins/super_admins to view student activation statuses
-- Safe to run after 001..006 migrations.
-- =============================================================================

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

  IF v_account_origin IN ('admin_staff', 'admin_student', 'super_admin_provision') THEN
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
