import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

export const SUPER_ADMIN_USERNAME = 'ENG/2012/0001';
export const SUPER_ADMIN_ACCOUNT_TYPE = 'Privileged Administrative Account';
export const SUPER_ADMIN_ROLE = 'super_admin' as const;

const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  'eng/2012/0001',
]);

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

export function verifyProvisionSecret(providedSecret: string): { ok: true } | { ok: false; status: number; error: string } {
  const configuredSecret = (process.env.SUPER_ADMIN_PROVISION_SECRET || '').trim();
  if (!configuredSecret || configuredSecret.length < 24) {
    return {
      ok: false,
      status: 503,
      error:
        'Secure Super Admin provisioning is disabled. Configure SUPER_ADMIN_PROVISION_SECRET (at least 24 random characters) on the server.',
    };
  }
  if (!providedSecret) {
    return {
      ok: false,
      status: 403,
      error: 'Valid provisioning authorization secret is required.',
    };
  }
  const providedBuf = Buffer.from(providedSecret, 'utf-8');
  const expectedBuf = Buffer.from(configuredSecret, 'utf-8');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid Super Admin provisioning secret.',
    };
  }
  return { ok: true };
}

export function validateSuperAdminPassword(password: string): string | null {
  if (!password || password.length < 12 || password.length > 128) {
    return 'Super Admin password must be between 12 and 128 characters.';
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Please choose a strong private password for the Super Admin account.';
  }
  return null;
}

function resolveSupabaseAdminEnv(): { url: string; serviceRoleKey: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    return null;
  }
  if (
    url.includes('your-project-id') ||
    serviceRoleKey.includes('your-service-role') ||
    serviceRoleKey.length < 20
  ) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }
  return { url, serviceRoleKey };
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
  const passErr = validateSuperAdminPassword(params.password);
  if (passErr) {
    return { status: 400, payload: { error: passErr } };
  }

  const supabaseAdmin = createClient(params.supabaseUrl, params.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Confirm ENG/2012/0001 is not already in privileged_accounts and no super_admin exists
  const [existingPrivRes, existingRoleRes, whitelistRes] = await Promise.all([
    supabaseAdmin
      .from('privileged_accounts')
      .select('id, login_username')
      .eq('login_username', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', SUPER_ADMIN_ROLE)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id')
      .eq('matric_number', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
  ]);

  if (existingPrivRes.error || existingRoleRes.error) {
    return {
      status: 500,
      payload: {
        error:
          'Unable to query Super Admin registry. Ensure migration 006_super_admin.sql has been applied.',
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

  // 2. Create Supabase Auth user with privileged server-only app_metadata
  const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    app_metadata: {
      account_origin: 'super_admin_provision',
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
    const status = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') ? 409 : 400;
    return { status, payload: { error: msg } };
  }

  const createdUserId = createdAuth.user.id;

  try {
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
      {
        id: createdUserId,
        full_name: fullName,
        email,
        phone,
        address: 'FUDMA Healthcenter Executive Administration',
        is_active: true,
      },
      { onConflict: 'id' }
    );
    if (profErr) throw new Error(profErr.message);

    const { error: roleErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: createdUserId,
        role: SUPER_ADMIN_ROLE,
        assigned_by: createdUserId,
      },
      { onConflict: 'user_id' }
    );
    if (roleErr) throw new Error(roleErr.message);

    // Ensure no patient row is left behind
    const { error: delPatErr } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('profile_id', createdUserId);
    if (delPatErr) throw new Error(delPatErr.message);

    const { error: privErr } = await supabaseAdmin.from('privileged_accounts').insert({
      user_id: createdUserId,
      login_username: SUPER_ADMIN_USERNAME,
      role: SUPER_ADMIN_ROLE,
      account_type: SUPER_ADMIN_ACCOUNT_TYPE,
      is_immutable: true,
    });
    if (privErr) throw new Error(privErr.message);

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: createdUserId,
      actor_name: fullName,
      actor_role: SUPER_ADMIN_ROLE,
      action: 'SUPER_ADMIN_PROVISIONED',
      entity_type: 'privileged_account',
      entity_id: SUPER_ADMIN_USERNAME,
      details: `Initial Privileged Administrative Account (${SUPER_ADMIN_USERNAME}) provisioned via secure server-side workflow.`,
    });

    return {
      status: 201,
      payload: {
        ok: true,
        user_id: createdUserId,
        login_username: SUPER_ADMIN_USERNAME,
        role: SUPER_ADMIN_ROLE,
        account_type: SUPER_ADMIN_ACCOUNT_TYPE,
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

  const secretCheck = verifyProvisionSecret(extractProvisionSecret(req));
  if (!secretCheck.ok) {
    sendJson(res, secretCheck.status, { error: secretCheck.error });
    return;
  }

  const env = resolveSupabaseAdminEnv();
  if (!env) {
    sendJson(res, 503, {
      error:
        'Server-side Supabase configuration is missing. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
    });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON request payload.' });
    return;
  }

  if (body.login_username !== undefined && normalizeUsername(body.login_username) !== SUPER_ADMIN_USERNAME) {
    sendJson(res, 400, {
      error: `Initial Super Admin login username is fixed to ${SUPER_ADMIN_USERNAME}.`,
    });
    return;
  }

  if (body.role !== undefined && String(body.role).trim() !== SUPER_ADMIN_ROLE) {
    sendJson(res, 400, {
      error: `Initial Super Admin role is fixed to ${SUPER_ADMIN_ROLE}.`,
    });
    return;
  }

  const result = await executeSupabaseSuperAdminProvision({
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    email: String(body.email || ''),
    password: String(body.password || ''),
    fullName: String(body.full_name || 'FUDMA Healthcenter Super Admin'),
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
