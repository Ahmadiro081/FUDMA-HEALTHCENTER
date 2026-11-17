import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

export interface ServerlessRequest extends IncomingMessage {
  method?: string;
  headers: IncomingMessage['headers'];
  body?: unknown;
  socket: IncomingMessage['socket'];
}

export interface ServerlessResponse extends ServerResponse {
  status?: (code: number) => ServerlessResponse;
  json?: (payload: unknown) => void;
}

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IDENTIFIER = 12;
const MAX_ATTEMPTS_PER_IP = 60;
const SUPER_ADMIN_USERNAME = 'ENG/2011/0001';
const attemptMap = new Map<string, number[]>();

function isRateLimited(key: string, max: number): number | null {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  if (attemptMap.size > 4000) {
    for (const [k, list] of attemptMap.entries()) {
      const recent = list.filter((ts) => ts > cutoff);
      if (recent.length === 0) attemptMap.delete(k);
      else attemptMap.set(k, recent);
    }
  }
  const recent = (attemptMap.get(key) || []).filter((ts) => ts > cutoff);
  if (recent.length >= max) {
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  attemptMap.set(key, recent);
  return null;
}

function getClientIp(req: ServerlessRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    return raw.split(',')[0].trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}

function sendJson(res: ServerlessResponse, statusCode: number, payload: unknown): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    res.json(payload);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: ServerlessRequest): Promise<Record<string, unknown>> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return req.body.trim() ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf-8').trim();
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    }
    if (typeof req.body === 'object') {
      return req.body as Record<string, unknown>;
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
    if (chunks.reduce((sum, b) => sum + b.length, 0) > 512 * 1024) {
      throw new Error('Request payload exceeds maximum allowed size.');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function normalizeMatric(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function isPublicAnonKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as {
      role?: string;
    };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

function resolveSupabaseServerEnv():
  | { ok: true; url: string; serviceRoleKey: string; anonOrAuthKey: string }
  | { ok: false; error: string } {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!url || !serviceRoleKey) {
    return {
      ok: false,
      error:
        'Server-side Supabase authentication service is not configured. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
    };
  }
  if (
    url.includes('your-project-id') ||
    serviceRoleKey.includes('your-service-role') ||
    serviceRoleKey.length < 20
  ) {
    return {
      ok: false,
      error:
        'Server-side Supabase authentication service contains placeholder values. Set valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    };
  }
  if (isPublicAnonKey(serviceRoleKey)) {
    return {
      ok: false,
      error:
        'SUPABASE_SERVICE_ROLE_KEY is currently set to a public anon/publishable key. Replace it with the secret service_role key from Supabase Project Settings → API.',
    };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'SUPABASE_URL must be a valid http(s) URL.' };
    }
  } catch {
    return { ok: false, error: 'SUPABASE_URL is not a valid URL.' };
  }

  return {
    ok: true,
    url,
    serviceRoleKey,
    anonOrAuthKey: anonKey && !anonKey.includes('your-public-supabase-anon-key') ? anonKey : serviceRoleKey,
  };
}

export async function loginWithMatricOrEmail(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  const env = resolveSupabaseServerEnv();
  if (!env.ok) {
    sendJson(res, 503, { error: env.error });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON request payload.' });
    return;
  }

  const rawIdentifier = String(
    body.identifier ?? body.email ?? body.matric_number ?? ''
  ).trim();
  const password = String(body.password ?? '');
  const adminOnly = body.admin_only === true;

  if (!rawIdentifier || !password) {
    sendJson(res, 400, {
      error: adminOnly
        ? 'Administrator email (or username) and password are required.'
        : 'Matriculation number (or email) and password are required.',
    });
    return;
  }
  if (password.length > 128) {
    sendJson(res, 400, { error: 'Invalid credentials.' });
    return;
  }

  const clientIp = getClientIp(req);
  const normKey = rawIdentifier.includes('@')
    ? rawIdentifier.toLowerCase()
    : normalizeMatric(rawIdentifier);

  const ipRetry = isRateLimited(`ip:${clientIp}`, MAX_ATTEMPTS_PER_IP);
  if (ipRetry !== null) {
    res.setHeader('Retry-After', String(ipRetry));
    sendJson(res, 429, {
      error: 'Too many sign-in attempts from this network address. Please try again later.',
    });
    return;
  }
  const idRetry = isRateLimited(`id:${clientIp}:${normKey}`, MAX_ATTEMPTS_PER_IDENTIFIER);
  if (idRetry !== null) {
    res.setHeader('Retry-After', String(idRetry));
    sendJson(res, 429, {
      error: 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.',
    });
    return;
  }

  let supabaseAdmin;
  let supabaseAuthClient;
  try {
    supabaseAdmin = createClient(env.url, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    supabaseAuthClient = createClient(env.url, env.anonOrAuthKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    sendJson(res, 503, { error: 'Unable to initialize Supabase authentication client.' });
    return;
  }

  let targetEmail: string | null = null;
  let privilegedAccount: { user_id: string; login_username: string; full_name: string } | null = null;
  const isEmailLogin = rawIdentifier.includes('@');

  if (isEmailLogin) {
    targetEmail = rawIdentifier.toLowerCase();
  } else {
    const normMatric = normalizeMatric(rawIdentifier);
    if (!/^[A-Z0-9]+\/\d{4}\/\d+$/.test(normMatric)) {
      sendJson(res, 401, { error: 'Invalid login username or password.' });
      return;
    }

    // 1. Check Privileged Administrative Accounts first (never on Group 11 whitelist)
    const { data: privRow, error: privErr } = await supabaseAdmin
      .from('privileged_accounts')
      .select('user_id, login_username, role')
      .eq('login_username', normMatric)
      .maybeSingle();

    if (privErr) {
      sendJson(res, 500, { error: 'Unable to verify credentials at this time.' });
      return;
    }

    if (privRow && privRow.role === 'super_admin' && privRow.user_id) {
      const [profRes, roleRes] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('full_name, email, is_active')
          .eq('id', privRow.user_id)
          .maybeSingle(),
        supabaseAdmin
          .from('user_roles')
          .select('role')
          .eq('user_id', privRow.user_id)
          .maybeSingle(),
      ]);

      if (
        profRes.error ||
        roleRes.error ||
        !profRes.data?.email ||
        roleRes.data?.role !== 'super_admin'
      ) {
        sendJson(res, 401, { error: 'Invalid login username or password.' });
        return;
      }

      if (profRes.data.is_active === false) {
        sendJson(res, 403, { error: 'This account has been deactivated by an administrator.' });
        return;
      }

      targetEmail = String(profRes.data.email).trim().toLowerCase();
      privilegedAccount = {
        user_id: String(privRow.user_id),
        login_username: String(privRow.login_username),
        full_name: String(profRes.data.full_name || 'Super Administrator'),
      };
    } else if (adminOnly) {
      // Dedicated admin login must never fall back to the Group 11 student whitelist
      sendJson(res, 401, {
        error: 'Access denied. No authorized Super Administrator account matches those credentials.',
      });
      return;
    } else if (normMatric === SUPER_ADMIN_USERNAME) {
      sendJson(res, 403, {
        error:
          'Initial Super Administrator (ENG/2011/0001) has not been provisioned yet. Complete secure server-side provisioning before signing in.',
      });
      return;
    } else {
      // 2. Fall back to Group 11 approved student whitelist lookup
      const { data: wlRow, error: wlErr } = await supabaseAdmin
        .from('group11_student_whitelist')
        .select('is_registered, registered_user_id')
        .eq('matric_number', normMatric)
        .maybeSingle();

      if (wlErr) {
        sendJson(res, 500, { error: 'Unable to verify student credentials at this time.' });
        return;
      }

      if (!wlRow || !wlRow.is_registered || !wlRow.registered_user_id) {
        sendJson(res, 401, { error: 'Invalid matriculation number or password.' });
        return;
      }

      const { data: profRow, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('email, is_active')
        .eq('id', wlRow.registered_user_id)
        .maybeSingle();

      if (profErr || !profRow || !profRow.email) {
        sendJson(res, 401, { error: 'Invalid matriculation number or password.' });
        return;
      }

      if (profRow.is_active === false) {
        sendJson(res, 403, { error: 'This account has been deactivated by an administrator.' });
        return;
      }

      targetEmail = String(profRow.email).trim().toLowerCase();
    }
  }

  const { data: authData, error: authError } = await supabaseAuthClient.auth.signInWithPassword({
    email: targetEmail,
    password,
  });

  if (authError || !authData.session) {
    const msg = (authError?.message || '').toLowerCase();
    if (msg.includes('email not confirmed')) {
      sendJson(res, 403, {
        error:
          'Please verify your email address before signing in. Check your inbox for the verification link.',
      });
      return;
    }
    sendJson(res, 401, {
      error: isEmailLogin
        ? 'Invalid email or password.'
        : privilegedAccount || adminOnly
          ? 'Invalid administrator username or password.'
          : 'Invalid matriculation number or password.',
    });
    return;
  }

  // Verify activation state, enforce adminOnly role guard, and record Super Admin login audit event
  if (privilegedAccount) {
    await supabaseAdmin
      .from('activity_logs')
      .insert({
        actor_id: privilegedAccount.user_id,
        actor_name: privilegedAccount.full_name,
        actor_role: 'super_admin',
        action: 'SUPER_ADMIN_LOGIN',
        entity_type: 'privileged_account',
        entity_id: privilegedAccount.login_username,
        details: `Super Admin authenticated using ${privilegedAccount.login_username}.`,
      })
      .then(() => {}, () => {});
  } else if (isEmailLogin && authData.user?.id) {
    const [profRes, roleRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('full_name, is_active')
        .eq('id', authData.user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', authData.user.id)
        .maybeSingle(),
    ]);
    if (profRes.data && profRes.data.is_active === false) {
      sendJson(res, 403, { error: 'This account has been deactivated by an administrator.' });
      return;
    }
    if (adminOnly && (roleRes.error || roleRes.data?.role !== 'super_admin')) {
      sendJson(res, 403, {
        error: 'Access denied. Only authorized Super Administrator accounts may sign in here.',
      });
      return;
    }
    if (roleRes.data?.role === 'super_admin') {
      await supabaseAdmin
        .from('activity_logs')
        .insert({
          actor_id: authData.user.id,
          actor_name: String(profRes.data?.full_name || 'Super Administrator'),
          actor_role: 'super_admin',
          action: 'SUPER_ADMIN_LOGIN',
          entity_type: 'privileged_account',
          entity_id: targetEmail,
          details: 'Super Admin authenticated via email.',
        })
        .then(() => {}, () => {});
    }
  } else if (adminOnly) {
    sendJson(res, 403, {
      error: 'Access denied. Only authorized Super Administrator accounts may sign in here.',
    });
    return;
  }

  sendJson(res, 200, {
    session: {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    },
  });
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await loginWithMatricOrEmail(req, res);
}
