import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const DESIGNATED_FULL_NAME = 'Ahmad Ibrahim';
const DESIGNATED_EMAIL = 'i.ahmad22044@fudutsinma.edu.ng';
const DESIGNATED_USERNAME = 'ENG/2011/0001';
const DESIGNATED_ROLE = 'super_admin';
const DESIGNATED_ACCOUNT_TYPE = 'Privileged Administrative Account';

function buildTemporaryTriggerSql(setupTokenHash: string): string {
  return `CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_hosp_no TEXT;
  v_account_origin TEXT;
  v_setup_token TEXT;
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
  v_setup_token := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'setup_token', '')), '');

  -- Temporary one-time Super Admin bootstrap gate (exact email + SHA-256 token)
  IF v_setup_token IS NOT NULL
     AND LOWER(TRIM(COALESCE(NEW.email, ''))) = '${DESIGNATED_EMAIL}' THEN

    IF encode(extensions.digest(convert_to(v_setup_token, 'UTF8'), 'sha256'), 'hex')
       <> '${setupTokenHash}' THEN
      RAISE EXCEPTION 'Access Denied. Invalid one-time Super Administrator setup token.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
      RAISE EXCEPTION 'Initial Super Administrator has already been provisioned and cannot be duplicated.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.privileged_accounts
      WHERE public.normalize_matric_number(login_username) = '${DESIGNATED_USERNAME}'
    ) THEN
      RAISE EXCEPTION 'Privileged username ${DESIGNATED_USERNAME} already exists.';
    END IF;

    v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), '${DESIGNATED_FULL_NAME}');

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (NEW.id, v_full_name, LOWER(NEW.email))
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'patient')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  v_account_origin := COALESCE(NEW.raw_app_meta_data->>'account_origin', '');

  v_phone := NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), '');
  v_gender := CASE
    WHEN NEW.raw_user_meta_data->>'gender' IN ('Male', 'Female', 'Other')
      THEN NEW.raw_user_meta_data->>'gender'
    ELSE NULL
  END;
  v_dob := CASE
    WHEN COALESCE(NEW.raw_user_meta_data->>'date_of_birth', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
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

  IF v_norm_matric = '${DESIGNATED_USERNAME}' OR EXISTS (
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
$$;`;
}

const RESTORE_TRIGGER_SQL = `CREATE OR REPLACE FUNCTION public.handle_new_user()
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
    WHEN COALESCE(NEW.raw_user_meta_data->>'date_of_birth', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
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

  IF v_norm_matric = '${DESIGNATED_USERNAME}' OR EXISTS (
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
$$;`;

export function SetupSuperAdminPage() {
  const { showToast } = useToast();

  const [provisionSecret, setProvisionSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const [setupTokenHash, setSetupTokenHash] = useState('');
  const [sealedToken, setSealedToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sqlAppliedConfirmed, setSqlAppliedConfirmed] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [preparing, setPreparing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [lockedMessage, setLockedMessage] = useState('');
  const [error, setError] = useState('');
  const [copiedTempSql, setCopiedTempSql] = useState(false);
  const [copiedRestoreSql, setCopiedRestoreSql] = useState(false);
  const [provisionedResult, setProvisionedResult] = useState<{
    user_id: string;
    email: string;
    login_username: string;
    role: string;
  } | null>(null);

  const isSecureTransport = useMemo(() => {
    if (typeof window === 'undefined') return true;
    const { protocol, hostname } = window.location;
    return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
  }, []);

  const temporarySql = useMemo(
    () => (setupTokenHash ? buildTemporaryTriggerSql(setupTokenHash) : ''),
    [setupTokenHash]
  );

  const handleCopyText = async (text: string, which: 'temp' | 'restore') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'temp') {
        setCopiedTempSql(true);
        setTimeout(() => setCopiedTempSql(false), 2000);
      } else {
        setCopiedRestoreSql(true);
        setTimeout(() => setCopiedRestoreSql(false), 2000);
      }
      showToast('SQL copied to clipboard', 'success');
    } catch {
      showToast('Select the SQL block and copy manually', 'info');
    }
  };

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLockedMessage('');

    if (!isSecureTransport) {
      setError('HTTPS is required before submitting setup secrets or private passwords.');
      return;
    }

    const secret = provisionSecret.trim();
    if (!secret) {
      setError('Enter your configured SUPER_ADMIN_PROVISION_SECRET.');
      return;
    }

    setPreparing(true);
    try {
      const res = await fetch('/api/admin/provision-super-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-provision-secret': secret,
        },
        body: JSON.stringify({ action: 'prepare' }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        locked?: boolean;
        error?: string;
        setup_token_hash?: string;
        sealed_token?: string;
        expires_at?: string;
      };

      if (!res.ok || !data.ok || !data.setup_token_hash || !data.sealed_token) {
        if (data.locked) {
          setLockedMessage(
            data.error ||
              'Super Administrator setup is permanently locked because the account already exists.'
          );
        } else {
          setError(data.error || `Unable to initialize setup (${res.status}).`);
        }
        return;
      }

      setSetupTokenHash(data.setup_token_hash);
      setSealedToken(data.sealed_token);
      setExpiresAt(data.expires_at || '');
      setSqlAppliedConfirmed(false);
      showToast('One-time setup hash generated on server', 'success');
    } catch {
      setError('Network error while contacting the setup API.');
    } finally {
      setPreparing(false);
    }
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isSecureTransport) {
      setError('HTTPS is required before submitting a private password.');
      return;
    }

    if (!sealedToken || !setupTokenHash) {
      setError('Generate the one-time setup hash in Step 1 first.');
      return;
    }

    if (!sqlAppliedConfirmed) {
      setError('Confirm that you have executed the temporary handle_new_user() SQL in Supabase.');
      return;
    }

    if (!password || password.length < 8) {
      setError('Choose a private password of at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setProvisioning(true);
    try {
      const res = await fetch('/api/admin/provision-super-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-provision-secret': provisionSecret.trim(),
        },
        body: JSON.stringify({
          action: 'provision',
          full_name: DESIGNATED_FULL_NAME,
          email: DESIGNATED_EMAIL,
          login_username: DESIGNATED_USERNAME,
          role: DESIGNATED_ROLE,
          password,
          sealed_token: sealedToken,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        locked?: boolean;
        error?: string;
        user_id?: string;
        email?: string;
        login_username?: string;
        role?: string;
      };

      if (!res.ok || !data.ok || !data.user_id) {
        if (data.locked) {
          setLockedMessage(
            data.error ||
              'Super Administrator setup is permanently locked because the account already exists.'
          );
          setSealedToken('');
          setSetupTokenHash('');
        } else {
          setError(data.error || `Provisioning failed (${res.status}).`);
        }
        return;
      }

      // Immediately clear sensitive inputs from browser memory
      setPassword('');
      setConfirmPassword('');
      setProvisionSecret('');
      setSealedToken('');
      setSetupTokenHash('');

      setProvisionedResult({
        user_id: data.user_id,
        email: data.email || DESIGNATED_EMAIL,
        login_username: data.login_username || DESIGNATED_USERNAME,
        role: data.role || DESIGNATED_ROLE,
      });
      showToast('Super Administrator account provisioned cleanly', 'success');
    } catch {
      setError('Network error while submitting provisioning request.');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F4C81]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to FUDMA HEALTHCENTER Home</span>
          </Link>
          <Link
            to="/admin-login"
            className="text-xs font-semibold text-[#0F4C81] hover:underline whitespace-nowrap shrink-0"
          >
            Go to Admin Sign In
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 p-6 sm:p-8 space-y-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#0369A1]">
                  FUDMA HEALTHCENTER · One-Time Executive Setup
                </p>
                <h1 className="mt-0.5 text-xl font-bold text-slate-900">
                  Initial Super Administrator Provisioning
                </h1>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Browser-guided HTTPS provisioning for the single designated Super Administrator
                  account. Tokens are generated and sealed strictly server-side without terminal
                  access.
                </p>
              </div>
            </div>

            {!isSecureTransport && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-900 flex items-start gap-2.5"
              >
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span>
                  Insecure transport detected. Open this setup page over HTTPS on your Vercel
                  deployment before submitting secrets or passwords.
                </span>
              </div>
            )}

            {/* Locked Designated Identity Summary */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-500">Full Name</span>
                <p className="mt-0.5 font-semibold text-slate-900">{DESIGNATED_FULL_NAME}</p>
              </div>
              <div>
                <span className="text-slate-500">Privileged Username</span>
                <p className="mt-0.5 font-mono font-semibold text-slate-900">
                  {DESIGNATED_USERNAME}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Institutional Email</span>
                <p className="mt-0.5 font-mono text-slate-900 break-all">{DESIGNATED_EMAIL}</p>
              </div>
              <div>
                <span className="text-slate-500">Role / Account Type</span>
                <p className="mt-0.5 font-medium text-slate-900">
                  <span className="font-mono">{DESIGNATED_ROLE}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span>{DESIGNATED_ACCOUNT_TYPE}</span>
                </p>
              </div>
            </div>

            {lockedMessage && (
              <div
                role="status"
                className="rounded-lg border border-slate-300 bg-slate-900 p-5 text-xs text-slate-100 space-y-3"
              >
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-white">Setup Endpoint Permanently Locked</p>
                    <p className="mt-1 text-slate-300 leading-relaxed">{lockedMessage}</p>
                  </div>
                </div>
                <div className="pt-1">
                  <Link
                    to="/admin-login"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Sign In via /admin-login</span>
                  </Link>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 flex items-start gap-2"
              >
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {provisionedResult ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Super Administrator Account Created &amp; Verified</span>
                  </div>
                  <p className="text-emerald-900 leading-relaxed">
                    User ID <code className="font-mono">{provisionedResult.user_id}</code> (
                    <code className="font-mono">{provisionedResult.login_username}</code>) is now
                    active with role <code className="font-mono">{provisionedResult.role}</code>.
                    The setup endpoint is now locked against reuse.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-slate-900">
                      Final Required Step: Restore Original handle_new_user()
                    </h2>
                    <button
                      type="button"
                      onClick={() => handleCopyText(RESTORE_TRIGGER_SQL, 'restore')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      {copiedRestoreSql ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedRestoreSql ? 'Copied Restore SQL' : 'Copy Restore SQL'}</span>
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Paste and run this exact SQL in the Supabase SQL Editor immediately, then
                    remove <code className="font-mono">SUPER_ADMIN_PROVISION_SECRET</code> from your
                    Vercel environment variables.
                  </p>
                  <pre className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3.5 text-[11px] font-mono text-slate-100 leading-relaxed">
                    {RESTORE_TRIGGER_SQL}
                  </pre>
                </div>

                <Link
                  to="/admin-login"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  <span>Proceed to Admin Sign In (/admin-login)</span>
                </Link>
              </div>
            ) : !lockedMessage && !setupTokenHash ? (
              <form onSubmit={handlePrepare} className="space-y-4">
                <div>
                  <label
                    htmlFor="setup-provision-secret"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Server Provisioning Authorization Secret *
                  </label>
                  <div className="relative">
                    <input
                      id="setup-provision-secret"
                      type={showSecret ? 'text' : 'password'}
                      required
                      value={provisionSecret}
                      onChange={(e) => setProvisionSecret(e.target.value)}
                      placeholder="Enter SUPER_ADMIN_PROVISION_SECRET from Vercel env"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-[#0369A1] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                      aria-label={showSecret ? 'Hide authorization secret' : 'Show authorization secret'}
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Must match the <code className="font-mono">SUPER_ADMIN_PROVISION_SECRET</code>{' '}
                    configured in Vercel (minimum 24 characters).
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={preparing || !isSecureTransport}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>
                    {preparing
                      ? 'Verifying Eligibility & Generating Hash...'
                      : 'Step 1: Verify Eligibility & Generate Setup Hash'}
                  </span>
                </button>
              </form>
            ) : !lockedMessage ? (
              <form onSubmit={handleProvision} className="space-y-5">
                <div className="space-y-2.5 pt-2 border-t border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Step 2: Apply Temporary handle_new_user() SQL
                      </h2>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Server-side SHA-256 hash generated
                        {expiresAt ? ` · Expires ${new Date(expiresAt).toLocaleTimeString()}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyText(temporarySql, 'temp')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      {copiedTempSql ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedTempSql ? 'Copied SQL' : 'Copy Temporary SQL'}</span>
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Run this SQL once in the Supabase SQL Editor. The raw one-time token never leaves
                    the server; only its SHA-256 hash is embedded below.
                  </p>

                  <pre className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3.5 text-[11px] font-mono text-slate-100 leading-relaxed">
                    {temporarySql}
                  </pre>

                  <label className="flex items-start gap-2.5 pt-1 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sqlAppliedConfirmed}
                      onChange={(e) => setSqlAppliedConfirmed(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-[#0F4C81] focus:ring-[#0369A1]"
                    />
                    <span>
                      I have executed the temporary <code className="font-mono">handle_new_user()</code>{' '}
                      SQL in Supabase SQL Editor.
                    </span>
                  </label>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    Step 3: Set Private Super Administrator Password
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="setup-admin-password"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Private Password *
                      </label>
                      <div className="relative">
                        <input
                          id="setup-admin-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 8 characters"
                          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-[#0369A1] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="setup-admin-confirm"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Confirm Password *
                      </label>
                      <input
                        id="setup-admin-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter private password"
                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0369A1] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSetupTokenHash('');
                      setSealedToken('');
                      setExpiresAt('');
                      setSqlAppliedConfirmed(false);
                      setError('');
                    }}
                    disabled={provisioning}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    Regenerate Hash
                  </button>
                  <button
                    type="submit"
                    disabled={provisioning || !isSecureTransport}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0369A1] disabled:opacity-60 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      {provisioning
                        ? 'Provisioning & Verifying Records...'
                        : 'Create Super Administrator Account'}
                    </span>
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          <aside className="lg:col-span-5 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-200 p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Serverless Security Controls</h2>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                This temporary setup workflow runs strictly over HTTPS with server-side Supabase
                credentials stored in Vercel environment variables.
              </p>

              <ul className="mt-5 space-y-4 text-xs">
                <li className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Server-Sealed Setup Token</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      A 32-byte random token is generated and AES-256-GCM sealed on the server.
                      Neither your password nor the raw setup token is ever exposed or logged.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-2.5">
                  <Database className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Conflict &amp; Rollback Safety</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      Pre-flight checks verify no existing <code className="font-mono">super_admin</code>,{' '}
                      <code className="font-mono">{DESIGNATED_USERNAME}</code>, or email exists. Any
                      stage failure deletes the newly created Auth user automatically.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-[#0F4C81] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">Permanent Post-Setup Lock</p>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      Once provisioned, the endpoint permanently rejects all subsequent requests and
                      is rate-limited against brute-force authorization attempts.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
              Preserves all existing Group 11 student registration rules, RLS policies, protection
              triggers, and single-super-admin database constraints.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
