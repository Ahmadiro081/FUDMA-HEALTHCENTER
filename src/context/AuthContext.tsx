import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, getStoredToken, setStoredToken } from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { AuthUser, DoctorRecord, PatientRecord, UserRole } from '../types/hospital';

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  authMode: 'supabase' | 'local';
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: Record<string, unknown>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  resetPassword: (payload: {
    email: string;
    new_password: string;
    hospital_or_staff_check?: string;
  }) => Promise<string>;
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
  const roleData = roleSettled.status === 'fulfilled' ? roleSettled.value.data : null;
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
      full_name: profile?.full_name || String(meta.full_name || email),
      email: profile?.email || email,
      phone: profile?.phone || null,
      gender: profile?.gender || null,
      date_of_birth: profile?.date_of_birth || null,
      address: profile?.address || null,
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const useSupabase = isSupabaseConfigured() && Boolean(supabase);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

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
          setStoredToken(data.session.access_token);
          const hydrated = await hydrateSupabaseUser(data.session);
          setUser(hydrated);
        }
      } catch {
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
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
  }, [useSupabase]);

  useEffect(() => {
    if (!useSupabase || !supabase) {
      void refreshUser();
      return;
    }

    let mounted = true;

    supabase.auth
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
        setStoredToken(data.session.access_token);
        const hydrated = await hydrateSupabaseUser(data.session);
        if (mounted) {
          setUser(hydrated);
          setLoading(false);
        }
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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);

      if (event === 'SIGNED_OUT' || !nextSession) {
        setStoredToken(null);
        setUser(null);
        setLoading(false);
        return;
      }

      setStoredToken(nextSession.access_token);
      if (event === 'TOKEN_REFRESHED') {
        return;
      }

      void hydrateSupabaseUser(nextSession)
        .then((hydrated) => {
          if (mounted) {
            setUser(hydrated);
            setLoading(false);
          }
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

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      if (useSupabase && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.session) {
          throw new Error(error?.message || 'Unable to sign in with Supabase.');
        }
        setSession(data.session);
        setStoredToken(data.session.access_token);
        const hydrated = await hydrateSupabaseUser(data.session);
        if (!hydrated) {
          throw new Error('Unable to load user profile.');
        }
        if (!hydrated.is_active) {
          await supabase.auth.signOut();
          throw new Error('This account has been deactivated by an administrator.');
        }
        setUser(hydrated);
        return hydrated;
      }

      const res = await api.auth.login(email, password);
      setStoredToken(res.token);
      setUser(res.user);
      return res.user;
    },
    [useSupabase]
  );

  const register = useCallback(
    async (payload: Record<string, unknown>): Promise<AuthUser> => {
      if (useSupabase && supabase) {
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: payload.full_name,
              phone: payload.phone,
              gender: payload.gender,
              matric_or_staff_id: payload.matric_or_staff_id,
              patient_category: payload.patient_category || 'Student',
            },
          },
        });
        if (error) {
          throw new Error(error.message);
        }
        if (!data.session) {
          throw new Error(
            'Registration successful. Please verify your email address before signing in.'
          );
        }
        setSession(data.session);
        setStoredToken(data.session.access_token);
        const hydrated = await hydrateSupabaseUser(data.session);
        if (!hydrated) {
          throw new Error('Account created, but profile hydration failed.');
        }
        setUser(hydrated);
        return hydrated;
      }

      const res = await api.auth.register(payload);
      setStoredToken(res.token);
      setUser(res.user);
      return res.user;
    },
    [useSupabase]
  );

  const logout = useCallback(async () => {
    if (useSupabase && supabase) {
      await supabase.auth.signOut();
      setSession(null);
      setStoredToken(null);
      setUser(null);
      return;
    }

    try {
      await api.auth.logout();
    } catch {
      // Clear local session regardless
    }
    setStoredToken(null);
    setUser(null);
  }, [useSupabase]);

  const resetPassword = useCallback(
    async (payload: {
      email: string;
      new_password: string;
      hospital_or_staff_check?: string;
    }): Promise<string> => {
      if (useSupabase && supabase) {
        const { error } = await supabase.auth.resetPasswordForEmail(payload.email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) {
          throw new Error(error.message);
        }
        return 'Password reset instructions have been sent to your registered email address.';
      }

      const res = await api.auth.resetPassword(payload);
      return res.message;
    },
    [useSupabase]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authMode: useSupabase ? 'supabase' : 'local',
        login,
        register,
        logout,
        resetPassword,
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
