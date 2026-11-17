-- =============================================================================
-- FUDMA HEALTHCENTER: Student Management & Deactivation Hardening
-- Migration: 009_student_management_and_portal_hardening.sql
-- Purpose:
--   1. Enforce active-account verification (`profiles.is_active = TRUE`) at the
--      PostgreSQL RLS & RPC helper layer so deactivated users cannot access
--      protected clinical tables or RPCs even with an unexpired JWT.
--   2. Preserve own-profile SELECT for authenticated users so AuthContext can
--      detect `is_active = FALSE` and sign the deactivated session out cleanly,
--      while blocking profile updates and all clinical/portal data access.
--   3. Keep all existing student, appointment, vital, consultation, lab, and
--      prescription records intact during deactivation and reactivation.
--   4. Preserve Super Admin immutability, Group 11 whitelist rules, and triggers.
-- Safe & idempotent to run after 001..008 migrations.
-- =============================================================================

-- 1. Helper to verify current authenticated user has an active profile
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = TRUE
  );
$$;

-- 2. Harden role & identity helper functions so inactive accounts resolve to NULL
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.role
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id
  WHERE ur.user_id = auth.uid()
    AND pr.is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_doctor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.doctors d
  JOIN public.profiles pr ON pr.id = d.profile_id
  WHERE d.profile_id = auth.uid()
    AND pr.is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_patient_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pt.id
  FROM public.patients pt
  JOIN public.profiles pr ON pr.id = pt.profile_id
  WHERE pt.profile_id = auth.uid()
    AND pr.is_active = TRUE
  LIMIT 1;
$$;

-- 3. Harden direct-UID RLS policies where `auth.uid()` was checked without role/active checks

-- PROFILES: Allow own row SELECT so client AuthContext detects is_active = FALSE and signs out;
-- block UPDATE for deactivated accounts.
DROP POLICY IF EXISTS "Users update own profile or admin updates any" ON public.profiles;
CREATE POLICY "Users update own profile or admin updates any"
  ON public.profiles FOR UPDATE
  USING (
    (public.profiles.id = auth.uid() AND public.is_active_user())
    OR public.is_super_admin()
    OR (public.get_my_role() = 'admin' AND NOT public.is_protected_super_admin(public.profiles.id))
  )
  WITH CHECK (
    (public.profiles.id = auth.uid() AND public.is_active_user())
    OR public.is_super_admin()
    OR (public.get_my_role() = 'admin' AND NOT public.is_protected_super_admin(public.profiles.id))
  );

-- USER ROLES: Inactive users cannot read roles directly
DROP POLICY IF EXISTS "Users read own role or admin reads all" ON public.user_roles;
CREATE POLICY "Users read own role or admin reads all"
  ON public.user_roles FOR SELECT
  USING (
    (user_id = auth.uid() AND public.is_active_user())
    OR public.is_admin_or_super()
  );

-- DOCTORS: Require active user profile
DROP POLICY IF EXISTS "Authenticated users view doctors" ON public.doctors;
CREATE POLICY "Authenticated users view doctors"
  ON public.doctors FOR SELECT
  USING (auth.role() = 'authenticated' AND public.is_active_user());

-- PATIENTS: Require active profile for patient self-access
DROP POLICY IF EXISTS "Patients view own record; clinical staff view patients" ON public.patients;
CREATE POLICY "Patients view own record; clinical staff view patients"
  ON public.patients FOR SELECT
  USING (
    (profile_id = auth.uid() AND public.is_active_user())
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
  USING (
    (profile_id = auth.uid() AND public.is_active_user())
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
  )
  WITH CHECK (
    (profile_id = auth.uid() AND public.is_active_user())
    OR public.get_my_role() IN ('nurse', 'admin', 'super_admin')
  );

-- NOTIFICATIONS: Block inactive accounts from reading or mutating notifications
DROP POLICY IF EXISTS "Users read notifications for their user or role" ON public.notifications;
CREATE POLICY "Users read notifications for their user or role"
  ON public.notifications FOR SELECT
  USING (
    public.is_active_user()
    AND (
      recipient_user_id = auth.uid()
      OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
    )
  );

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (
    public.is_active_user()
    AND (
      recipient_user_id = auth.uid()
      OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
      OR public.is_admin_or_super()
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND (
      recipient_user_id = auth.uid()
      OR (recipient_user_id IS NULL AND recipient_role = public.get_my_role())
      OR public.is_admin_or_super()
    )
  );

-- GROUP 11 WHITELIST: Block inactive accounts from reading whitelist claims
DROP POLICY IF EXISTS "Students view own whitelist claim" ON public.group11_student_whitelist;
CREATE POLICY "Students view own whitelist claim"
  ON public.group11_student_whitelist FOR SELECT
  USING (
    (registered_user_id = auth.uid() AND public.is_active_user())
    OR public.is_admin_or_super()
  );

-- ACTIVITY LOGS: Explicit active check for authenticated inserts
DROP POLICY IF EXISTS "Users log own verified actions" ON public.activity_logs;
CREATE POLICY "Users log own verified actions"
  ON public.activity_logs FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND public.is_active_user()
    AND actor_id = auth.uid()
    AND actor_role = public.get_my_role()
  );

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
