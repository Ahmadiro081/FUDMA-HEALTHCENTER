import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPER_ADMIN_FULL_NAME = 'Ahmad Ibrahim';
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
const MAX_PROVISION_ATTEMPTS_PER_IP = 12;
const MAX_FAILED_AUTH_PER_IP = 5;
const SEALED_TOKEN_TTL_MS = 30 * 60 * 1000;
const SEAL_AAD = Buffer.from('fudma-super-admin-setup-v1', 'utf8');

const provisionAttemptMap = new Map<string, number[]>();
const failedAuthAttemptMap = new Map<string, number[]>();
const usedSetupTokenJtis = new Map<string, number>();

const WEAK_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789012',
  'password',
  'password123',
  'qwerty',
  'admin123',
  'fudma@123',
  'fudma@2026',
  'superadmin',
  'eng/2011/0001',
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

interface SealedSetupPayload {
  token: string;
  jti: string;
  email: string;
  exp: number;
}

function getClientIp(req: ServerlessRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    return raw.split(',')[0].trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}

function recordSlidingWindow(map: Map<string, number[]>, key: string, max: number): number | null {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  if (map.size > 2000) {
    for (const [k, list] of map.entries()) {
      const recent = list.filter((ts) => ts > cutoff);
      if (recent.length === 0) map.delete(k);
      else map.set(k, recent);
    }
  }
  const recent = (map.get(key) || []).filter((ts) => ts > cutoff);
  if (recent.length >= max) {
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  map.set(key, recent);
  return null;
}

function isAuthLockedOut(ip: string): number | null {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (failedAuthAttemptMap.get(ip) || []).filter((ts) => ts > cutoff);
  if (recent.length === 0) {
    failedAuthAttemptMap.delete(ip);
    return null;
  }
  failedAuthAttemptMap.set(ip, recent);
  if (recent.length >= MAX_FAILED_AUTH_PER_IP) {
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  return null;
}

function recordFailedAuth(ip: string): void {
  recordSlidingWindow(failedAuthAttemptMap, ip, MAX_FAILED_AUTH_PER_IP + 1);
}

function sendJson(res: ServerlessResponse, statusCode: number, payload: unknown): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    res.json(payload);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
    if (chunks.reduce((sum, b) => sum + b.length, 0) > 256 * 1024) {
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

export function verifyProvisionSecret(
  providedSecret: string
): { ok: true; configuredSecret: string } | { ok: false; status: number; error: string } {
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
        'Super Admin setup endpoint is disabled. Configure SUPER_ADMIN_PROVISION_SECRET (at least 24 random characters) in Vercel environment variables.',
    };
  }
  if (!providedSecret) {
    return {
      ok: false,
      status: 403,
      error: 'Valid Super Admin provisioning authorization secret is required.',
    };
  }
  const providedHash = crypto.createHash('sha256').update(providedSecret, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(configuredSecret, 'utf8').digest();
  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid Super Admin provisioning secret.',
    };
  }
  return { ok: true, configuredSecret };
}

export function validateSuperAdminPassword(password: string): string | null {
  if (!password || password.length < 8 || password.length > 128) {
    return 'Super Admin password must be between 8 and 128 characters.';
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Please choose a stronger private password for the Super Admin account.';
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
        'Server-side Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.',
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
        'SUPABASE_SERVICE_ROLE_KEY is currently set to a public anon/publishable key. Set the secret service_role key in Vercel environment variables.',
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

function deriveSealKey(configuredSecret: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(`fudma-setup-seal-v1:${configuredSecret}`, 'utf8')
    .digest();
}

function sealSetupToken(payload: SealedSetupPayload, configuredSecret: string): string {
  const key = deriveSealKey(configuredSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(SEAL_AAD);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

function unsealSetupToken(
  sealedToken: string,
  configuredSecret: string
): { ok: true; payload: SealedSetupPayload } | { ok: false; status: number; error: string } {
  const parts = sealedToken.trim().split('.');
  if (parts.length !== 3) {
    return {
      ok: false,
      status: 400,
      error: 'Malformed setup challenge token. Generate a fresh setup hash in Step 1.',
    };
  }
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const encrypted = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error('Invalid seal envelope.');
    }
    const key = deriveSealKey(configuredSecret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(SEAL_AAD);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as Partial<SealedSetupPayload>;
    if (
      !parsed ||
      typeof parsed.token !== 'string' ||
      typeof parsed.jti !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      throw new Error('Incomplete setup challenge payload.');
    }
    if (Date.now() > parsed.exp) {
      return {
        ok: false,
        status: 410,
        error: 'The one-time setup hash has expired. Generate a fresh setup hash in Step 1.',
      };
    }
    if (parsed.email !== DESIGNATED_SUPER_ADMIN_EMAIL) {
      return {
        ok: false,
        status: 403,
        error: 'Setup challenge email binding mismatch.',
      };
    }
    pruneUsedJtis();
    if (usedSetupTokenJtis.has(parsed.jti)) {
      return {
        ok: false,
        status: 409,
        error: 'This one-time setup token has already been used.',
      };
    }
    return {
      ok: true,
      payload: {
        token: parsed.token,
        jti: parsed.jti,
        email: parsed.email,
        exp: parsed.exp,
      },
    };
  } catch {
    return {
      ok: false,
      status: 403,
      error: 'Invalid or tampered setup challenge token. Generate a fresh setup hash in Step 1.',
    };
  }
}

function pruneUsedJtis(): void {
  const now = Date.now();
  if (usedSetupTokenJtis.size < 200) return;
  for (const [jti, exp] of usedSetupTokenJtis.entries()) {
    if (exp <= now) usedSetupTokenJtis.delete(jti);
  }
}

async function checkPreProvisionConflicts(
  supabaseAdmin: SupabaseClient,
  email: string
): Promise<{ ok: true } | { ok: false; status: number; payload: Record<string, unknown> }> {
  const [roleCheck, privCheck, whitelistCheck, patientCheck, profileCheck] = await Promise.all([
    supabaseAdmin.from('user_roles').select('user_id').eq('role', SUPER_ADMIN_ROLE).maybeSingle(),
    supabaseAdmin
      .from('privileged_accounts')
      .select('user_id, login_username')
      .eq('login_username', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id')
      .eq('matric_number', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('patients')
      .select('id')
      .eq('matric_or_staff_id', SUPER_ADMIN_USERNAME)
      .maybeSingle(),
    supabaseAdmin.from('profiles').select('id').ilike('email', email).maybeSingle(),
  ]);

  if (
    roleCheck.error ||
    privCheck.error ||
    whitelistCheck.error ||
    patientCheck.error ||
    profileCheck.error
  ) {
    return {
      ok: false,
      status: 500,
      payload: {
        error:
          'Pre-flight verification query failed. Ensure schema migrations 001–008 are applied.',
      },
    };
  }

  if (roleCheck.data) {
    return {
      ok: false,
      status: 409,
      payload: {
        locked: true,
        error:
          'Setup endpoint is permanently locked: a Super Administrator already exists in public.user_roles.',
      },
    };
  }

  if (privCheck.data) {
    return {
      ok: false,
      status: 409,
      payload: {
        locked: true,
        error: `Setup endpoint is permanently locked: username ${SUPER_ADMIN_USERNAME} already exists in public.privileged_accounts.`,
      },
    };
  }

  if (whitelistCheck.data || patientCheck.data) {
    return {
      ok: false,
      status: 409,
      payload: {
        error: `Aborted: ${SUPER_ADMIN_USERNAME} exists in student/patient records and will not be overwritten.`,
      },
    };
  }

  if (profileCheck.data) {
    return {
      ok: false,
      status: 409,
      payload: {
        locked: true,
        error: `Aborted: email ${email} already exists in public.profiles and will not be overwritten.`,
      },
    };
  }

  let page = 1;
  while (page <= 10) {
    const { data: usersPage, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listErr) {
      return {
        ok: false,
        status: 500,
        payload: { error: `Pre-flight Auth user lookup failed: ${listErr.message}` },
      };
    }
    const match = usersPage.users.find(
      (u) => (u.email || '').trim().toLowerCase() === email
    );
    if (match) {
      return {
        ok: false,
        status: 409,
        payload: {
          locked: true,
          error: `Aborted: email ${email} already exists in auth.users (ID: ${match.id}) and will not be overwritten.`,
        },
      };
    }
    if (usersPage.users.length < 200) break;
    page += 1;
  }

  return { ok: true };
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

  const clientIp = getClientIp(req);
  const authLockout = isAuthLockedOut(clientIp);
  if (authLockout !== null) {
    res.setHeader('Retry-After', String(authLockout));
    sendJson(res, 429, {
      error: 'Too many failed authorization attempts. Please wait 15 minutes and try again.',
    });
    return;
  }

  const retryAfter = recordSlidingWindow(
    provisionAttemptMap,
    clientIp,
    MAX_PROVISION_ATTEMPTS_PER_IP
  );
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, {
      error: 'Too many setup requests from this address. Please try again later.',
    });
    return;
  }

  const providedSecret = extractProvisionSecret(req);
  const secretCheck = verifyProvisionSecret(providedSecret);
  if (!secretCheck.ok) {
    if (secretCheck.status === 403) {
      recordFailedAuth(clientIp);
    }
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

  const action = String(body.action || 'provision').trim().toLowerCase();
  if (action !== 'prepare' && action !== 'provision') {
    sendJson(res, 400, { error: 'Unsupported setup action.' });
    return;
  }

  const supabaseAdmin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Always enforce pre-flight checks on both prepare and provision
  const preflight = await checkPreProvisionConflicts(supabaseAdmin, DESIGNATED_SUPER_ADMIN_EMAIL);
  if (!preflight.ok) {
    sendJson(res, preflight.status, preflight.payload);
    return;
  }

  if (action === 'prepare') {
    // Generate cryptographically random one-time setup token strictly server-side (never returned or logged)
    const rawSetupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenHash = crypto.createHash('sha256').update(rawSetupToken, 'utf8').digest('hex');
    const exp = Date.now() + SEALED_TOKEN_TTL_MS;
    const sealedToken = sealSetupToken(
      {
        token: rawSetupToken,
        jti: crypto.randomBytes(16).toString('hex'),
        email: DESIGNATED_SUPER_ADMIN_EMAIL,
        exp,
      },
      secretCheck.configuredSecret
    );

    sendJson(res, 200, {
      ok: true,
      setup_token_hash: setupTokenHash,
      sealed_token: sealedToken,
      expires_at: new Date(exp).toISOString(),
    });
    return;
  }

  // Validate fixed designated identity
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

  const normalizedEmail = String(body.email || DESIGNATED_SUPER_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  if (!VALID_EMAIL_REGEX.test(normalizedEmail) || normalizedEmail !== DESIGNATED_SUPER_ADMIN_EMAIL) {
    sendJson(res, 403, {
      error: `Initial Super Admin email is restricted exclusively to ${DESIGNATED_SUPER_ADMIN_EMAIL}.`,
    });
    return;
  }

  const fullName = String(body.full_name || SUPER_ADMIN_FULL_NAME).trim() || SUPER_ADMIN_FULL_NAME;
  const phone = body.phone ? String(body.phone).trim() || null : null;
  const password = String(body.password || '');
  const passErr = validateSuperAdminPassword(password);
  if (passErr) {
    sendJson(res, 400, { error: passErr });
    return;
  }

  const sealedTokenRaw = String(body.sealed_token || '').trim();
  if (!sealedTokenRaw) {
    sendJson(res, 400, {
      error: 'Generate the server-side setup hash in Step 1 before submitting.',
    });
    return;
  }

  const unsealed = unsealSetupToken(sealedTokenRaw, secretCheck.configuredSecret);
  if (!unsealed.ok) {
    sendJson(res, unsealed.status, { error: unsealed.error });
    return;
  }

  const { token: rawSetupToken, jti, exp } = unsealed.payload;

  // Stage 3: Create unconfirmed, temporarily banned Auth user with one-time setup_token
  const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: DESIGNATED_SUPER_ADMIN_EMAIL,
    password,
    email_confirm: false,
    ban_duration: '15m',
    app_metadata: {
      account_origin: 'super_admin_provision',
      privileged_username: SUPER_ADMIN_USERNAME,
      account_type: SUPER_ADMIN_ACCOUNT_TYPE,
    },
    user_metadata: {
      full_name: fullName,
      setup_token: rawSetupToken,
    },
  });

  if (createErr || !createdAuth.user) {
    const msg = createErr?.message || 'Auth user creation failed.';
    const lower = msg.toLowerCase();
    const status = lower.includes('already') || lower.includes('exists') ? 409 : 400;
    sendJson(res, status, { error: msg });
    return;
  }

  usedSetupTokenJtis.set(jti, exp);
  const userId = createdAuth.user.id;

  try {
    // Stage 4: Immediately scrub setup_token from user_metadata and verify removal
    const { data: scrubbed, error: scrubErr } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: {
          full_name: fullName,
          setup_token: null,
        },
      }
    );
    if (scrubErr || scrubbed.user?.user_metadata?.setup_token != null) {
      throw new Error(`Metadata scrub failed: ${scrubErr?.message || 'Setup token still present.'}`);
    }

    // Stage 5: Upsert profile, assign super_admin role, and verify role persistence
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        full_name: fullName,
        email: DESIGNATED_SUPER_ADMIN_EMAIL,
        phone,
        address: 'FUDMA Healthcenter Executive Administration',
        is_active: true,
      },
      { onConflict: 'id' }
    );
    if (profErr) {
      throw new Error(`Profile upsert failed: ${profErr.message}`);
    }

    const { error: roleErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: userId,
        role: SUPER_ADMIN_ROLE,
        assigned_by: userId,
      },
      { onConflict: 'user_id' }
    );
    if (roleErr) {
      throw new Error(`Role assignment failed: ${roleErr.message}`);
    }

    const { data: verifiedRole, error: verifyRoleErr } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    if (verifyRoleErr || verifiedRole?.role !== SUPER_ADMIN_ROLE) {
      throw new Error('Role verification failed: super_admin was not persisted.');
    }

    // Stage 6: Insert & verify privileged_accounts record
    const { error: privErr } = await supabaseAdmin.from('privileged_accounts').insert({
      user_id: userId,
      login_username: SUPER_ADMIN_USERNAME,
      role: SUPER_ADMIN_ROLE,
      account_type: SUPER_ADMIN_ACCOUNT_TYPE,
      is_immutable: true,
    });
    if (privErr) {
      throw new Error(`Privileged account insert failed: ${privErr.message}`);
    }

    const { data: verifiedPriv, error: verifyPrivErr } = await supabaseAdmin
      .from('privileged_accounts')
      .select('login_username, role')
      .eq('user_id', userId)
      .single();
    if (verifyPrivErr || verifiedPriv?.login_username !== SUPER_ADMIN_USERNAME) {
      throw new Error('Privileged account verification failed.');
    }

    // Stage 7: Confirm email, lift temporary ban, and write audit log
    const { error: activateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      ban_duration: 'none',
    });
    if (activateErr) {
      throw new Error(`Account activation failed: ${activateErr.message}`);
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: userId,
      actor_name: fullName,
      actor_role: SUPER_ADMIN_ROLE,
      action: 'SUPER_ADMIN_PROVISIONED',
      entity_type: 'privileged_account',
      entity_id: SUPER_ADMIN_USERNAME,
      details: `Provisioned one-time Super Admin (${SUPER_ADMIN_USERNAME}) via HTTPS setup endpoint.`,
    });

    sendJson(res, 201, {
      ok: true,
      user_id: userId,
      email: DESIGNATED_SUPER_ADMIN_EMAIL,
      login_username: SUPER_ADMIN_USERNAME,
      role: SUPER_ADMIN_ROLE,
      account_type: SUPER_ADMIN_ACCOUNT_TYPE,
    });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    const message = err instanceof Error ? err.message : 'Unable to finalize Super Admin records.';
    sendJson(res, 500, { error: `Super Admin provisioning rolled back: ${message}` });
  }
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await provisionSuperAdminHandler(req, res);
}
