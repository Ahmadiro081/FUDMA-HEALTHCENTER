import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

export const SUPER_ADMIN_USERNAME = 'ENG/2011/0001';
export const SUPER_ADMIN_ACCOUNT_TYPE = 'Privileged Administrative Account';
export const SUPER_ADMIN_ROLE = 'super_admin' as const;
export const DESIGNATED_SUPER_ADMIN_EMAIL = (
  process.env.DESIGNATED_SUPER_ADMIN_EMAIL || 'i.ahmad22044@fudutsinma.edu.ng'
)
  .trim()
  .toLowerCase();

const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_PROVISION_ATTEMPTS_PER_IP = 15;
const provisionAttemptMap = new Map<string, number[]>();
const WEAK_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789012',
  'password',
  'password123',
  'qwerty',
  'admin123',
  'fudma@2026',
  'superadmin',
  'eng/2011/0001',
  'eng/2012/0001',
]);

function getClientIp(req: ServerlessRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    return raw.split(',')[0].trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): number | null {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  if (provisionAttemptMap.size > 2000) {
    for (const [k, list] of provisionAttemptMap.entries()) {
      const recent = list.filter((ts) => ts > cutoff);
      if (recent.length === 0) provisionAttemptMap.delete(k);
      else provisionAttemptMap.set(k, recent);
    }
  }
  const recent = (provisionAttemptMap.get(ip) || []).filter((ts) => ts > cutoff);
  if (recent.length >= MAX_PROVISION_ATTEMPTS_PER_IP) {
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  provisionAttemptMap.set(ip, recent);
  return null;
}

export interface ServerlessRequest extends IncomingMessage {
  method?: string;
  headers: IncomingMessage['headers'];
  body?: unknown;
}

export interface ServerlessResponse extends ServerResponse {
  status?: (code: number) => ServerlessResponse;
  json?: (payload: unknown) => void;
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

function normalizeUsername(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function extractProvisionSecret(req: ServerlessRequest): string {
  const customHeader = req.headers['x-provision-secret'];
  const headerVal = Array.isArray(customHeader) ? customHeader[0] : customHeader;
  if (headerVal && headerVal.trim()) {
    return headerVal.trim();
  }
  const authHeader = req.headers.authorization;
  const authVal = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (authVal && authVal.startsWith('Bearer ')) {
    return authVal.slice(7).trim();
  }
  return '';
}

const PLACEHOLDER_PROVISION_SECRETS = new Set([
  'change-this-to-a-long-random-string',
  'your-super-admin-provision-secret',
  'super-admin-secret',
  'fudma-healthcenter-secret',
]);

export function verifyProvisionSecret(providedSecret: string): { ok: true } | { ok: false; status: number; error: string } {
  if (!providedSecret) {
    return {
      ok: false,
      status: 403,
      error: 'Valid Super Admin provisioning authorization secret is required.',
    };
  }
  const configuredSecret = (process.env.SUPER_ADMIN_PROVISION_SECRET || '').trim();
  if (
    !configuredSecret ||
    configuredSecret.length < 24 ||
    PLACEHOLDER_PROVISION_SECRETS.has(configuredSecret.toLowerCase())
  ) {
    return {
      ok: false,
      status: 503,
      error:
        'Secure Super Admin provisioning is disabled. Configure SUPER_ADMIN_PROVISION_SECRET (at least 24 random characters) on the server.',
    };
  }
  // Hash both secrets with SHA-256 so buffer lengths are constant before timingSafeEqual
  const providedHash = crypto.createHash('sha256').update(providedSecret, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(configuredSecret, 'utf8').digest();
  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid Super Admin provisioning secret.',
    };
  }
  return { ok: true };
}

export function validateSuperAdminPassword(password: string): string | null {
  if (!password || password.length < 8 || password.length > 128) {
    return 'Super Admin password must be between 8 and 128 characters.';
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Please choose a strong private password for the Super Admin account.';
  }
  return null;
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

function resolveSupabaseAdminEnv():
  | { ok: true; url: string; serviceRoleKey: string }
  | { ok: false; error: string } {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    return {
      ok: false,
      error:
        'Server-side Supabase configuration is missing. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
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
        'Server-side Supabase configuration contains placeholder values. Set valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    };
  }
  if (isPublicAnonKey(serviceRoleKey)) {
    return {
      ok: false,
      error:
        'SUPABASE_SERVICE_ROLE_KEY is currently set to a public anon/publishable key. Set the secret service_role key from Supabase Project Settings → API in server environment variables.',
    };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        error: 'SUPABASE_URL must be a valid http(s) URL.',
      };
    }
  } catch {
    return {
      ok: false,
      error: 'SUPABASE_URL is not a valid URL.',
    };
  }
  return { ok: true, url, serviceRoleKey };
}

export interface ProvisionSuperAdminParams {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
}

export async function executeSupabaseSuperAdminProvision(
  params: ProvisionSuperAdminParams
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim();
  const phone = params.phone ? params.phone.trim() : null;

  if (!fullName || !email || !params.password) {
    return {
      status: 400,
      payload: { error: 'Full name, institutional email, and private password are required.' },
    };
  }
  if (!VALID_EMAIL_REGEX.test(email)) {
    return {
      status: 400,
      payload: { error: 'Please provide a valid institutional email address.' },
    };
  }
  if (email !== DESIGNATED_SUPER_ADMIN_EMAIL) {
    return {
      status: 403,
      payload: {
        error: `Initial Super Admin email is restricted exclusively to ${DESIGNATED_SUPER_ADMIN_EMAIL}.`,
      },
    };
  }
  const passErr = validateSuperAdminPassword(params.password);
  if (passErr) {
    return { status: 400, payload: { error: passErr } };
  }

  const supabaseAdmin = createClient(params.supabaseUrl, params.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Confirm ENG/2011/0001 is not already in privileged_accounts, no super_admin exists, and email is unused
  const [existingPrivRes, existingRoleRes, whitelistRes, existingProfileRes] = await Promise.all([
    supabaseAdmin
      .from('privileged_accounts')
      .select('id, login_username')
      .eq('login_username', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', SUPER_ADMIN_ROLE)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id')
      .eq('matric_number', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle(),
  ]);

  if (existingPrivRes.error || existingRoleRes.error || whitelistRes.error || existingProfileRes.error) {
    return {
      status: 500,
      payload: {
        error:
          'Unable to query Super Admin registry. Ensure migration 006_super_admin.sql has been applied.',
      },
    };
  }

  if (existingProfileRes.data) {
    return {
      status: 409,
      payload: {
        error: 'An account with this email address already exists and will not be overwritten.',
      },
    };
  }

  if (whitelistRes.data) {
    return {
      status: 409,
      payload: {
        error: `${SUPER_ADMIN_USERNAME} must never exist in group11_student_whitelist.`,
      },
    };
  }

  if (existingPrivRes.data || existingRoleRes.data) {
    return {
      status: 409,
      payload: {
        error: `Super Admin (${SUPER_ADMIN_USERNAME}) has already been provisioned and cannot be duplicated or overwritten.`,
      },
    };
  }

  // 1b. Check Supabase Auth directly for any pre-existing auth.users row with this email
  try {
    let page = 1;
    const perPage = 200;
    while (page <= 10) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listErr || !listData?.users?.length) break;
      const conflictUser = listData.users.find(
        (u) => (u.email || '').trim().toLowerCase() === email
      );
      if (conflictUser) {
        return {
          status: 409,
          payload: {
            error: `An authentication record for ${email} already exists in Supabase Auth (User ID: ${conflictUser.id}) and will not be overwritten.`,
          },
        };
      }
      if (listData.users.length < perPage) break;
      page += 1;
    }
  } catch {
    // Proceed cleanly if listUsers is unavailable
  }

  // 2. Create Supabase Auth user with 'admin_staff' initial origin
  const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    app_metadata: {
      account_origin: 'admin_staff',
      privileged_username: SUPER_ADMIN_USERNAME,
      account_type: SUPER_ADMIN_ACCOUNT_TYPE,
    },
    user_metadata: {
      full_name: fullName,
      phone,
    },
  });

  if (createErr || !createdAuth.user) {
    const msg = createErr?.message || 'Failed to create Super Admin in Supabase Auth.';
    const lower = msg.toLowerCase();
    const status = lower.includes('already') || lower.includes('exists') ? 409 : 400;
    return { status, payload: { error: msg } };
  }

  const createdUserId = createdAuth.user.id;

  try {
    const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(createdUserId, {
      app_metadata: {
        account_origin: 'super_admin_provision',
        privileged_username: SUPER_ADMIN_USERNAME,
        account_type: SUPER_ADMIN_ACCOUNT_TYPE,
      },
    });
    if (metaErr) throw new Error(metaErr.message);

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'rpc_finalize_super_admin_provision',
      {
        p_user_id: createdUserId,
        p_full_name: fullName,
        p_email: email,
        p_phone: phone,
        p_login_username: SUPER_ADMIN_USERNAME,
        p_account_type: SUPER_ADMIN_ACCOUNT_TYPE,
      }
    );

    if (rpcErr) {
      throw new Error(rpcErr.message);
    }

    return {
      status: 201,
      payload: {
        ok: true,
        user_id: createdUserId,
        login_username: SUPER_ADMIN_USERNAME,
        role: SUPER_ADMIN_ROLE,
        account_type: SUPER_ADMIN_ACCOUNT_TYPE,
        ...(typeof rpcResult === 'object' && rpcResult !== null ? rpcResult : {}),
      },
    };
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(createdUserId).catch(() => {});
    const message = err instanceof Error ? err.message : 'Unable to finalize Super Admin records.';
    return {
      status: 500,
      payload: { error: `Super Admin provisioning rolled back: ${message}` },
    };
  }
}

export async function provisionSuperAdminHandler(
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

  const retryAfter = checkRateLimit(getClientIp(req));
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, {
      error: 'Too many provisioning attempts from this address. Please try again later.',
    });
    return;
  }

  const providedSecret = extractProvisionSecret(req);
  const secretCheck = verifyProvisionSecret(providedSecret);
  if (!secretCheck.ok) {
    sendJson(res, secretCheck.status, { error: secretCheck.error });
    return;
  }

  const env = resolveSupabaseAdminEnv();
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

  const requestedMatric = normalizeUsername(body.matric_number ?? body.login_username);
  if (
    (body.login_username !== undefined || body.matric_number !== undefined) &&
    requestedMatric !== SUPER_ADMIN_USERNAME
  ) {
    sendJson(res, 403, {
      error: `Initial Super Admin registration is restricted exclusively to ${SUPER_ADMIN_USERNAME}.`,
    });
    return;
  }

  if (body.role !== undefined && String(body.role).trim() !== SUPER_ADMIN_ROLE) {
    sendJson(res, 403, {
      error: `Initial Super Admin role is fixed to ${SUPER_ADMIN_ROLE}.`,
    });
    return;
  }

  const normalizedEmail = String(body.email || '')
    .trim()
    .toLowerCase();

  const result = await executeSupabaseSuperAdminProvision({
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    email: normalizedEmail,
    password: String(body.password || ''),
    fullName: String(body.full_name || 'Ahmad Ibrahim'),
    phone: body.phone ? String(body.phone) : null,
  });

  sendJson(res, result.status, result.payload);
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await provisionSuperAdminHandler(req, res);
}
