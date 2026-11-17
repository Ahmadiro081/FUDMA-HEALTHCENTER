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

export function hasAnySupabaseConfig(): boolean {
  const hasUrl = Boolean(supabaseUrl && !supabaseUrl.includes('your-project-id'));
  const hasKey = Boolean(supabaseAnonKey && !supabaseAnonKey.includes('your-public-supabase-anon-key'));
  return hasUrl || hasKey;
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  missingKeys: string[];
  urlPreview: string | null;
} {
  const missingKeys: string[] = [];
  if (!supabaseUrl || !/^https?:\/\//i.test(supabaseUrl) || supabaseUrl.includes('your-project-id')) {
    missingKeys.push('VITE_SUPABASE_URL');
  }
  if (!supabaseAnonKey || supabaseAnonKey.includes('your-public-supabase-anon-key')) {
    missingKeys.push('VITE_SUPABASE_ANON_KEY');
  }

  let urlPreview: string | null = null;
  if (supabaseUrl && /^https?:\/\//i.test(supabaseUrl) && !supabaseUrl.includes('your-project-id')) {
    try {
      urlPreview = new URL(supabaseUrl).hostname;
    } catch {
      urlPreview = null;
    }
  }

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    urlPreview,
  };
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

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.'
    );
  }
  return supabase;
}
