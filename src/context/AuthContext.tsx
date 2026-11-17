import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, getStoredToken, setStoredToken } from '../lib/api';
import { hasAnySupabaseConfig, isSupabaseConfigured, supabase } from '../lib/supabase';
import type { AuthUser, DoctorRecord, MatricVerificationResult, PatientRecord, UserRole } from '../types/hospital';

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  authMode: 'supabase' | 'local' | 'unconfigured';
  recoveryMode: boolean;
  verifyMatric: (matricNumber: string) => Promise<MatricVerificationResult>;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  loginAdmin: (identifier: string, password: string) => Promise<AuthUser>;
  register: (payload: Record<string, unknown>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<string>;
  updateRecoveryPassword: (newPassword: string) => Promise<string>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function getRoleDashboardPath(role: UserRole): string {
  switch (role) {
    case 'patient':
      return '/portal/patient';
    case 'nurse':
      return '/portal/nursing';
    case 'doctor':
      return '/portal/doctor';
    case 'lab':
      return '/portal/laboratory';
    case 'pharmacy':
      return '/portal/pharmacy';
    case 'admin':
    case 'super_admin':
      return '/portal/admin';
    default:
      return '/login';
  }
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'patient':
      return 'Patient Portal';
    case 'nurse':
      return 'Nursing Station';
    case 'doctor':
      return 'Consultant / Doctor';
    case 'lab':
      return 'Medical Laboratory';
    case 'pharmacy':
      return 'Hospital Pharmacy';
    case 'admin':
      return 'System Administrator';
    case 'super_admin':
      return 'Super Administrator';
  }
}

async function hydrateSupabaseUser(activeSession: Session): Promise<AuthUser | null> {
  if (!supabase) return null;
  const authUid = activeSession.user.id;
  const email = activeSession.user.email || '';

  const [profileSettled, roleSettled, patientSettled, doctorSettled] = await Promise.allSettled([
    supabase.from('profiles').select('*').eq('id', authUid).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', authUid).maybeSingle(),
    supabase.from('patients').select('*').eq('profile_id', authUid).maybeSingle(),
    supabase
      .from('doctors')
      .select('*, departments(name)')
      .eq('profile_id', authUid)
      .maybeSingle(),
  ]);

  const profile = profileSettled.status === 'fulfilled' ? profileSettled.value.data : null;
  if (roleSettled.status === 'rejected' || roleSettled.value.error) {
    throw new Error('Unable to verify assigned account role from database.');
  }
  const roleData = roleSettled.value.data;
  const patientData = patientSettled.status === 'fulfilled' ? patientSettled.value.data : null;
  const doctorData = doctorSettled.status === 'fulfilled' ? doctorSettled.value.data : null;

  const resolvedRole = (roleData?.role as UserRole | undefined) || 'patient';
  const meta = (activeSession.user.user_metadata || {}) as Record<string, unknown>;

  let patient: PatientRecord | null = null;
  if (patientData) {
    const p = patientData;
    patient = {
      id: p.id,
      profile_id: p.profile_id,
      hospital_number: p.hospital_number,
      matric_or_staff_id: p.matric_or_staff_id,
      patient_category: p.patient_category,
      faculty_or_unit: p.faculty_or_unit,
      blood_group: p.blood_group,
      genotype: p.genotype,
      allergies: p.allergies,
      emergency_contact_name: p.emergency_contact_name,
      emergency_contact_phone: p.emergency_contact_phone,
      is_walk_in: p.is_walk_in,
      full_name: profile?.full_name || p.full_name || String(meta.full_name || email),
      email: profile?.email || p.email || email,
      phone: profile?.phone ?? p.phone ?? null,
      gender: profile?.gender ?? p.gender ?? null,
      date_of_birth: profile?.date_of_birth ?? p.date_of_birth ?? null,
      address: profile?.address ?? p.address ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  let doctor: DoctorRecord | null = null;
  if (doctorData) {
    const d = doctorData as Record<string, unknown> & { departments?: { name?: string } | null };
    doctor = {
      id: String(d.id),
      profile_id: String(d.profile_id),
      department_id: String(d.department_id),
      department_name: d.departments?.name || undefined,
      staff_code: String(d.staff_code),
      specialization: String(d.specialization),
      license_number: (d.license_number as string | null) ?? null,
      consultation_room: (d.consultation_room as string | null) ?? null,
      is_available: Boolean(d.is_available),
      full_name: profile?.full_name || String(meta.full_name || email),
      email: profile?.email || email,
      phone: profile?.phone || null,
      created_at: String(d.created_at),
      updated_at: String(d.updated_at),
    };
  }

  return {
    id: authUid,
    full_name: profile?.full_name || String(meta.full_name || email.split('@')[0] || 'User'),
    email: profile?.email || email,
    phone: profile?.phone ?? (meta.phone ? String(meta.phone) : null),
    gender: profile?.gender ?? null,
    date_of_birth: profile?.date_of_birth ?? null,
    address: profile?.address ?? null,
    role: resolvedRole,
    is_active: profile?.is_active ?? true,
    patient,
    doctor,
  };
}

function hasRecoveryUrlHint(): boolean {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return hash.includes('type=recovery') || search.includes('type=recovery');
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const useSupabase = isSupabaseConfigured() && Boolean(supabase);
  const authMode: AuthContextValue['authMode'] = useSupabase
    ? 'supabase'
    : import.meta.env.PROD || hasAnySupabaseConfig()
      ? 'unconfigured'
      : 'local';

  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() => useSupabase && hasRecoveryUrlHint());
  const verifyingAdminRef = useRef<boolean>(false);

  const refreshUser = useCallback(async () => {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          setSession(null);
          setUser(null);
          setStoredToken(null);
        } else {
          setSession(data.session);
          setStoredToken(null);
          const hydrated = await hydrateSupabaseUser(data.session);
          if (hydrated && !hydrated.is_active) {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
          } else {
            setUser(hydrated);
          }
        }
      } catch {
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (authMode === 'unconfigured') {
      setStoredToken(null);
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }

    const token = getStoredToken();
    if (!token) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.auth.me();
      setUser(res.user);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [useSupabase, authMode]);

  useEffect(() => {
    if (!useSupabase || !supabase) {
      void refreshUser();
      return;
    }

    let mounted = true;
    const sb = supabase;

    sb.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!mounted) return;
        if (error || !data.session) {
          setSession(null);
          setUser(null);
          setStoredToken(null);
          setLoading(false);
          return;
        }
        setSession(data.session);
        setStoredToken(null);
        const hydrated = await hydrateSupabaseUser(data.session);
        if (!mounted) return;
        if (hydrated && !hydrated.is_active) {
          await sb.auth.signOut();
          setSession(null);
          setUser(null);
        } else {
          setUser(hydrated);
        }
        setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (verifyingAdminRef.current) {
        return;
      }
      setSession(nextSession);

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
      }

      if (event === 'SIGNED_OUT' || !nextSession) {
        setStoredToken(null);
        setUser(null);
        setRecoveryMode(false);
        setLoading(false);
        return;
      }

      setStoredToken(null);
      if (event === 'TOKEN_REFRESHED') {
        return;
      }

      void hydrateSupabaseUser(nextSession)
        .then(async (hydrated) => {
          if (!mounted) return;
          if (hydrated && !hydrated.is_active) {
            await sb.auth.signOut();
            setSession(null);
            setUser(null);
          } else {
            setUser(hydrated);
          }
          setLoading(false);
        })
        .catch(() => {
          if (mounted) {
            setLoading(false);
          }
        });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [useSupabase, refreshUser]);

  const verifyMatric = useCallback(
    async (matricNumber: string): Promise<MatricVerificationResult> => {
      if (authMode === 'unconfigured') {
        throw new Error(
          'Production Supabase authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
        );
      }
      return api.auth.verifyMatric(matricNumber);
    },
    [authMode]
  );

  const login = useCallback(
    async (identifier: string, password: string): Promise<AuthUser> => {
      const trimmedIdentifier = identifier.trim();
      if (!trimmedIdentifier || !password) {
        throw new Error('Matriculation number (or email) and password are required.');
      }

      if (useSupabase && supabase) {
        let activeSession: Session | null = null;

        if (trimmedIdentifier.includes('@')) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: trimmedIdentifier.toLowerCase(),
            password,
          });
          if (error || !data.session) {
            throw new Error(error?.message || 'Unable to sign in with Supabase.');
          }
          activeSession = data.session;
        } else {
          // Matriculation number login: server resolves registered user email from whitelist and authenticates through Supabase Auth
          const res = await fetch('/api/auth/login-matric', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: trimmedIdentifier, password }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            session?: { access_token?: string; refresh_token?: string };
          };
          if (!res.ok || !body.session?.access_token || !body.session?.refresh_token) {
            throw new Error(body.error || 'Invalid login username or password.');
          }
          const { data: sessData, error: sessErr } = await supabase.auth.setSession({
            access_token: body.session.access_token,
            refresh_token: body.session.refresh_token,
          });
          if (sessErr || !sessData.session) {
            throw new Error(sessErr?.message || 'Unable to establish authenticated Supabase session.');
          }
          activeSession = sessData.session;
        }

        setSession(activeSession);
        setStoredToken(null);
        const hydrated = await hydrateSupabaseUser(activeSession);
        if (!hydrated) {
          throw new Error('Unable to load user profile.');
        }
        if (!hydrated.is_active) {
          await supabase.auth.signOut();
          throw new Error('This account has been deactivated by an administrator.');
        }
        if (hydrated.role === 'super_admin' && trimmedIdentifier.includes('@')) {
          try {
            await supabase.from('activity_logs').insert({
              actor_id: hydrated.id,
              actor_name: hydrated.full_name,
              actor_role: 'super_admin',
              action: 'SUPER_ADMIN_LOGIN',
              entity_type: 'privileged_account',
              entity_id: hydrated.email,
              details: 'Super Admin authenticated via email.',
            });
          } catch {
            // Audit failure must not crash active session setup
          }
        }
        setRecoveryMode(false);
        setUser(hydrated);
        return hydrated;
      }

      if (authMode === 'unconfigured') {
        throw new Error(
          'Production Supabase authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
        );
      }

      const res = await api.auth.login(trimmedIdentifier, password);
      setStoredToken(res.token);
      setUser(res.user);
      return res.user;
    },
    [useSupabase, authMode]
  );

  const loginAdmin = useCallback(
    async (identifier: string, password: string): Promise<AuthUser> => {
      const trimmedIdentifier = identifier.trim();
      if (!trimmedIdentifier || !password) {
        throw new Error('Administrator email (or username) and password are required.');
      }

      if (useSupabase && supabase) {
        verifyingAdminRef.current = true;
        try {
          let activeSession: Session | null = null;

          if (trimmedIdentifier.includes('@')) {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: trimmedIdentifier.toLowerCase(),
              password,
            });
            if (error || !data.session) {
              throw new Error(error?.message || 'Unable to sign in with Supabase.');
            }
            activeSession = data.session;
          } else {
            // Admin username login resolves strictly against privileged_accounts (never Group 11 student whitelist)
            const res = await fetch('/api/auth/login-matric', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                identifier: trimmedIdentifier,
                password,
                admin_only: true,
              }),
            });
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
              session?: { access_token?: string; refresh_token?: string };
            };
            if (!res.ok || !body.session?.access_token || !body.session?.refresh_token) {
              throw new Error(body.error || 'Invalid administrator username or password.');
            }
            const { data: sessData, error: sessErr } = await supabase.auth.setSession({
              access_token: body.session.access_token,
              refresh_token: body.session.refresh_token,
            });
            if (sessErr || !sessData.session) {
              throw new Error(
                sessErr?.message || 'Unable to establish authenticated Supabase session.'
              );
            }
            activeSession = sessData.session;
          }

          const hydrated = await hydrateSupabaseUser(activeSession);
          if (!hydrated) {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
            setStoredToken(null);
            throw new Error('Unable to verify administrator profile from database.');
          }
          if (!hydrated.is_active) {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
            setStoredToken(null);
            throw new Error('This administrator account has been deactivated.');
          }
          if (hydrated.role !== 'super_admin') {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
            setStoredToken(null);
            throw new Error(
              'Access denied. Only authorized Super Administrator accounts may sign in to the Administrative Portal.'
            );
          }

          if (trimmedIdentifier.includes('@')) {
            try {
              await supabase.from('activity_logs').insert({
                actor_id: hydrated.id,
                actor_name: hydrated.full_name,
                actor_role: 'super_admin',
                action: 'SUPER_ADMIN_LOGIN',
                entity_type: 'privileged_account',
                entity_id: hydrated.email,
                details: 'Super Admin authenticated via /admin-login.',
              });
            } catch {
              // Audit failure must not block active verified Super Admin sign-in
            }
          }

          setSession(activeSession);
          setStoredToken(null);
          setRecoveryMode(false);
          setUser(hydrated);
          return hydrated;
        } finally {
          verifyingAdminRef.current = false;
        }
      }

      if (authMode === 'unconfigured') {
        throw new Error(
          'Production Supabase authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
        );
      }

      const res = await api.auth.login(trimmedIdentifier, password, true);
      if (res.user.role !== 'super_admin' || !res.user.is_active) {
        setStoredToken(null);
        setUser(null);
        throw new Error(
          'Access denied. Only authorized Super Administrator accounts may sign in to the Administrative Portal.'
        );
      }
      setStoredToken(res.token);
      setUser(res.user);
      return res.user;
    },
    [useSupabase, authMode]
  );

  const register = useCallback(
    async (payload: Record<string, unknown>): Promise<AuthUser> => {
      const normalizedMatric = String(payload.matric_or_staff_id || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
      if (!normalizedMatric) {
        throw new Error('Please verify your Group 11 matriculation number before creating an account.');
      }
      if (normalizedMatric === 'ENG/2011/0001') {
        throw new Error(
          'ENG/2011/0001 is the designated Initial Super Administrator identity and cannot be registered as a public patient account.'
        );
      }

      if (useSupabase && supabase) {
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: {
              full_name: payload.full_name,
              phone: payload.phone,
              gender: payload.gender,
              date_of_birth: payload.date_of_birth,
              address: payload.address,
              matric_or_staff_id: normalizedMatric,
              patient_category: 'Student',
              faculty_or_unit: payload.faculty_or_unit,
              blood_group: payload.blood_group || 'Unknown',
              genotype: payload.genotype || 'Unknown',
              allergies: payload.allergies,
              emergency_contact_name: payload.emergency_contact_name,
              emergency_contact_phone: payload.emergency_contact_phone,
            },
          },
        });
        if (error) {
          throw new Error(error.message);
        }
        if (!data.session) {
          throw new Error(
            'Registration successful. Please check your email inbox to verify your account before signing in.'
          );
        }
        setSession(data.session);
        setStoredToken(null);
        const hydrated = await hydrateSupabaseUser(data.session);
        if (!hydrated) {
          throw new Error('Account created, but profile hydration failed.');
        }
        setUser(hydrated);
        return hydrated;
      }

      if (authMode === 'unconfigured') {
        throw new Error(
          'Production Supabase authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
        );
      }

      const res = await api.auth.register({
        ...payload,
        matric_or_staff_id: normalizedMatric,
      });
      setStoredToken(res.token);
      setUser(res.user);
      return res.user;
    },
    [useSupabase, authMode]
  );

  const logout = useCallback(async () => {
    if (useSupabase && supabase) {
      await supabase.auth.signOut();
      setSession(null);
      setStoredToken(null);
      setRecoveryMode(false);
      setUser(null);
      return;
    }

    if (authMode === 'local') {
      try {
        await api.auth.logout();
      } catch {
        // Clear local session regardless
      }
    }
    setStoredToken(null);
    setRecoveryMode(false);
    setUser(null);
  }, [useSupabase, authMode]);

  const resetPassword = useCallback(
    async (email: string): Promise<string> => {
      if (useSupabase && supabase) {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
          throw new Error('Please enter your registered email address.');
        }
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          throw new Error(error.message);
        }
        return 'Password reset instructions have been sent to your registered email address.';
      }

      throw new Error(
        authMode === 'unconfigured'
          ? 'Supabase Auth must be configured to enable verified email password recovery.'
          : 'Self-service password reset is disabled in standalone mode. Contact your System Administrator or configure Supabase Auth email recovery.'
      );
    },
    [useSupabase, authMode]
  );

  const updateRecoveryPassword = useCallback(
    async (newPassword: string): Promise<string> => {
      if (!useSupabase || !supabase) {
        throw new Error('Supabase Auth must be configured to update your recovery password.');
      }
      if (!newPassword || newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        throw new Error(error.message);
      }
      setRecoveryMode(false);
      await refreshUser();
      return 'Your password has been updated securely.';
    },
    [useSupabase, refreshUser]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authMode,
        recoveryMode,
        verifyMatric,
        login,
        loginAdmin,
        register,
        logout,
        resetPassword,
        updateRecoveryPassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
