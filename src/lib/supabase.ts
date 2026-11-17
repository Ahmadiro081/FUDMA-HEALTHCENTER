import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      /^https?:\/\//i.test(supabaseUrl) &&
      !supabaseUrl.includes('your-project-id') &&
      !supabaseAnonKey.includes('your-public-supabase-anon-key')
  );
}

export const supabase: SupabaseClient | null =
  isSupabaseConfigured() && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export function getSupabaseClient(): SupabaseClient | null {
  return supabase;
}
