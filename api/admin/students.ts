import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

const SUPER_ADMIN_USERNAME = 'ENG/2011/0001';
const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_MATRIC_REGEX = /^[A-Z0-9]+\/\d{4}\/\d+$/;
const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GENDERS = new Set(['Male', 'Female', 'Other']);
const ALLOWED_BLOOD_GROUPS = new Set(['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const ALLOWED_GENOTYPES = new Set(['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC']);
const WEAK_PASSWORDS = new Set(['123456', 'password', 'qwerty', '12345678', 'abcdef']);

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
    if (chunks.reduce((sum, b) => sum + b.length, 0) > 1024 * 1024) {
      throw new Error('Request payload exceeds maximum allowed size.');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function getBearerToken(req: ServerlessRequest): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return null;
  }
  const token = value.slice(7).trim();
  return token || null;
}

function normalizeMatric(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
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
        'Server-side Supabase Admin provisioning is not configured. Set valid SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in server environment variables.',
    };
  }
  if (
    url.includes('your-project-id') ||
    serviceRoleKey.includes('your-service-role') ||
    serviceRoleKey.length < 20
  ) {
    return {
      ok: false,
      error: 'Server-side Supabase Admin provisioning is not configured with valid credentials.',
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
  return { ok: true, url, serviceRoleKey };
}

function generateHospitalNumber(userId: string): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = userId.replace(/-/g, '').slice(0, 5).toUpperCase();
  const rand = crypto.randomBytes(1).toString('hex').toUpperCase();
  return `FUDMA-HC-${yy}${mm}-${suffix}${rand}`;
}

export async function provisionSupabaseStudent(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'Method not allowed. Use POST or PATCH.' });
    return;
  }

  const env = resolveSupabaseAdminEnv();
  if (!env.ok) {
    sendJson(res, 503, { error: env.error });
    return;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { error: 'Administrator Bearer token is required.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON request payload.' });
    return;
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = createClient(env.url, env.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  } catch {
    sendJson(res, 503, {
      error: 'Server-side Supabase Admin client could not be initialized. Verify SUPABASE_URL configuration.',
    });
    return;
  }

  // 1. Authenticate caller JWT & verify active admin or super_admin role
  const {
    data: { user: callerUser },
    error: callerErr,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (callerErr || !callerUser) {
    sendJson(res, 401, { error: 'Invalid or expired Supabase session token.' });
    return;
  }

  const [callerProfileRes, callerRoleRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, full_name, is_active')
      .eq('id', callerUser.id)
      .maybeSingle(),
    supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerUser.id)
      .maybeSingle(),
  ]);

  if (callerProfileRes.error || callerRoleRes.error) {
    sendJson(res, 500, { error: 'Unable to verify administrator privileges.' });
    return;
  }

  if (!callerProfileRes.data || !callerProfileRes.data.is_active) {
    sendJson(res, 403, { error: 'Administrator account is inactive.' });
    return;
  }

  const callerRole = String(callerRoleRes.data?.role || '');
  if (callerRole !== 'admin' && callerRole !== 'super_admin') {
    sendJson(res, 403, { error: 'Only System Administrators can provision or manage student accounts.' });
    return;
  }

  // Handle PATCH: toggle student portal account activation state
  if (req.method === 'PATCH') {
    const targetUserId = String(body.user_id || '').trim();
    const isActive = body.is_active;
    if (!targetUserId || typeof isActive !== 'boolean') {
      sendJson(res, 400, { error: 'user_id and boolean is_active are required.' });
      return;
    }

    const [targetRoleRes, targetProfRes] = await Promise.all([
      supabaseAdmin.from('user_roles').select('role').eq('user_id', targetUserId).maybeSingle(),
      supabaseAdmin.from('profiles').select('id, full_name, email').eq('id', targetUserId).maybeSingle(),
    ]);

    if (targetRoleRes.error || targetProfRes.error || !targetProfRes.data) {
      sendJson(res, 404, { error: 'Student account profile not found.' });
      return;
    }
    if (targetRoleRes.data?.role !== 'patient') {
      sendJson(res, 403, { error: 'This endpoint only manages student patient portal accounts.' });
      return;
    }

    const { error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', targetUserId);

    if (updErr) {
      sendJson(res, 500, { error: updErr.message || 'Unable to update student account status.' });
      return;
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: callerUser.id,
      actor_name: callerProfileRes.data.full_name,
      actor_role: callerRole,
      action: isActive ? 'STUDENT_ACCOUNT_ACTIVATED' : 'STUDENT_ACCOUNT_DEACTIVATED',
      entity_type: 'profile',
      entity_id: targetProfRes.data.email,
      details: `${isActive ? 'Activated' : 'Deactivated'} student portal access for ${targetProfRes.data.full_name}.`,
    });

    sendJson(res, 200, { ok: true, user_id: targetUserId, is_active: isActive });
    return;
  }

  // 2. Validate POST student creation payload
  const fullName = String(body.full_name || '').trim();
  const normMatric = normalizeMatric(body.matric_number);
  const department = String(body.department || body.faculty_or_unit || '').trim();
  const normalizedEmail = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');
  const phone = body.phone ? String(body.phone).trim() : null;
  const gender = body.gender ? String(body.gender).trim() : null;
  const dob = body.date_of_birth ? String(body.date_of_birth).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  const bloodGroup = body.blood_group ? String(body.blood_group).trim() : 'Unknown';
  const genotype = body.genotype ? String(body.genotype).trim() : 'Unknown';
  const allergies = body.allergies ? String(body.allergies).trim() : 'None reported';
  const emergencyName = body.emergency_contact_name ? String(body.emergency_contact_name).trim() : null;
  const emergencyPhone = body.emergency_contact_phone ? String(body.emergency_contact_phone).trim() : null;

  if (!fullName || fullName.length < 2 || fullName.length > 120) {
    sendJson(res, 400, { error: 'Student full name must be between 2 and 120 characters.' });
    return;
  }
  if (!normMatric || !VALID_MATRIC_REGEX.test(normMatric)) {
    sendJson(res, 400, {
      error: 'Please enter a valid FUDMA matriculation number (e.g., ENG/2024/32094).',
    });
    return;
  }
  if (normMatric === SUPER_ADMIN_USERNAME) {
    sendJson(res, 403, {
      error: `${SUPER_ADMIN_USERNAME} is reserved for the Super Administrator and cannot be assigned to a student.`,
    });
    return;
  }
  if (!department) {
    sendJson(res, 400, { error: 'Academic department / faculty is required.' });
    return;
  }
  if (!normalizedEmail || !VALID_EMAIL_REGEX.test(normalizedEmail)) {
    sendJson(res, 400, { error: 'Please enter a valid student email address.' });
    return;
  }
  if (!password || password.length < 6 || password.length > 128) {
    sendJson(res, 400, { error: 'Assigned student password must be between 6 and 128 characters.' });
    return;
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    sendJson(res, 400, { error: 'Please choose a stronger unique password for this student.' });
    return;
  }
  if (gender && !ALLOWED_GENDERS.has(gender)) {
    sendJson(res, 400, { error: 'Invalid gender selection.' });
    return;
  }
  if (dob && !VALID_DATE_REGEX.test(dob)) {
    sendJson(res, 400, { error: 'Invalid date of birth format (YYYY-MM-DD).' });
    return;
  }
  if (!ALLOWED_BLOOD_GROUPS.has(bloodGroup)) {
    sendJson(res, 400, { error: 'Invalid blood group selection.' });
    return;
  }
  if (!ALLOWED_GENOTYPES.has(genotype)) {
    sendJson(res, 400, { error: 'Invalid genotype selection.' });
    return;
  }

  // 3. Check reserved privileged accounts & duplicates before creating Auth user
  const [privCheck, existingWlRes, existingPatientRes, existingProfEmailRes] = await Promise.all([
    supabaseAdmin
      .from('privileged_accounts')
      .select('id')
      .eq('login_username', normMatric)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id, is_registered, registered_user_id')
      .eq('matric_number', normMatric)
      .maybeSingle(),
    supabaseAdmin
      .from('patients')
      .select('id')
      .eq('matric_or_staff_id', normMatric)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle(),
  ]);

  if (privCheck.data) {
    sendJson(res, 403, { error: 'This identifier belongs to a privileged account and cannot be assigned.' });
    return;
  }
  if (existingWlRes.data && (existingWlRes.data.is_registered || existingWlRes.data.registered_user_id)) {
    sendJson(res, 409, { error: `Matriculation number ${normMatric} is already registered in the portal.` });
    return;
  }
  if (existingPatientRes.data) {
    sendJson(res, 409, { error: `A patient record already exists for matriculation number ${normMatric}.` });
    return;
  }
  if (existingProfEmailRes.data) {
    sendJson(res, 409, { error: 'An account with this student email address already exists.' });
    return;
  }

  // 4. Create Supabase Auth user via Admin API (immediately email-confirmed so student can log in right away)
  const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    app_metadata: {
      account_origin: 'admin_staff',
    },
    user_metadata: {
      full_name: fullName,
      phone,
      matric_or_staff_id: normMatric,
      patient_category: 'Student',
    },
  });

  if (createAuthErr || !createdAuth.user) {
    const msg = createAuthErr?.message || 'Unable to create student account in Supabase Auth.';
    const status = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') ? 409 : 400;
    sendJson(res, status, { error: msg });
    return;
  }

  const createdUserId = createdAuth.user.id;
  const nowIso = new Date().toISOString();
  const hospitalNumber = generateHospitalNumber(createdUserId);
  let insertedNewWhitelistId: string | null = null;
  let updatedExistingWhitelistId: string | null = null;

  // 5. Synchronize profiles, user_roles ('patient'), group11_student_whitelist (for matric login), and patients
  try {
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: createdUserId,
          full_name: fullName,
          email: normalizedEmail,
          phone,
          gender,
          date_of_birth: dob,
          address,
          is_active: true,
        },
        { onConflict: 'id' }
      );
    if (profErr) {
      throw new Error(profErr.message);
    }

    const { error: roleErr } = await supabaseAdmin
      .from('user_roles')
      .upsert(
        {
          user_id: createdUserId,
          role: 'patient',
          assigned_by: callerUser.id,
        },
        { onConflict: 'user_id' }
      );
    if (roleErr) {
      throw new Error(roleErr.message);
    }

    if (existingWlRes.data?.id) {
      const { error: wlUpdErr } = await supabaseAdmin
        .from('group11_student_whitelist')
        .update({
          full_name: fullName,
          department,
          is_registered: true,
          registered_user_id: createdUserId,
          registered_at: nowIso,
        })
        .eq('id', existingWlRes.data.id);
      if (wlUpdErr) {
        throw new Error(wlUpdErr.message);
      }
      updatedExistingWhitelistId = String(existingWlRes.data.id);
    } else {
      const { data: wlIns, error: wlInsErr } = await supabaseAdmin
        .from('group11_student_whitelist')
        .insert({
          full_name: fullName,
          matric_number: normMatric,
          department,
          is_registered: true,
          registered_user_id: createdUserId,
          registered_at: nowIso,
        })
        .select('id')
        .single();
      if (wlInsErr) {
        throw new Error(wlInsErr.message);
      }
      insertedNewWhitelistId = String(wlIns.id);
    }

    const { data: patRow, error: patErr } = await supabaseAdmin
      .from('patients')
      .insert({
        profile_id: createdUserId,
        hospital_number: hospitalNumber,
        matric_or_staff_id: normMatric,
        patient_category: 'Student',
        faculty_or_unit: department,
        blood_group: bloodGroup,
        genotype,
        allergies,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
        is_walk_in: false,
        full_name: fullName,
        email: normalizedEmail,
        phone,
        gender,
        date_of_birth: dob,
        address,
      })
      .select('*')
      .single();

    if (patErr || !patRow) {
      throw new Error(patErr?.message || 'Unable to create synchronized patient medical file.');
    }

    await Promise.all([
      supabaseAdmin.from('notifications').insert({
        recipient_user_id: createdUserId,
        title: 'Welcome to FUDMA HEALTHCENTER',
        message: `Your student portal account (${hospitalNumber}) for ${normMatric} was provisioned by Administration.`,
        category: 'account',
      }),
      supabaseAdmin.from('activity_logs').insert({
        actor_id: callerUser.id,
        actor_name: callerProfileRes.data.full_name,
        actor_role: callerRole,
        action: 'ADMIN_STUDENT_CREATED',
        entity_type: 'patient',
        entity_id: hospitalNumber,
        details: `Provisioned & synced student portal account for ${fullName} (${normMatric}, ${department}).`,
      }),
    ]);

    sendJson(res, 201, {
      ok: true,
      student: {
        user_id: createdUserId,
        patient_id: String(patRow.id),
        hospital_number: hospitalNumber,
        matric_number: normMatric,
        full_name: fullName,
        email: normalizedEmail,
        department,
        phone,
        is_active: true,
        created_at: String(patRow.created_at || nowIso),
      },
    });
  } catch (err) {
    // Full rollback so partial records never orphan Auth or whitelist entries
    await supabaseAdmin.from('patients').delete().eq('profile_id', createdUserId).then(() => {}, () => {});
    if (insertedNewWhitelistId) {
      await supabaseAdmin
        .from('group11_student_whitelist')
        .delete()
        .eq('id', insertedNewWhitelistId)
        .then(() => {}, () => {});
    } else if (updatedExistingWhitelistId) {
      await supabaseAdmin
        .from('group11_student_whitelist')
        .update({
          is_registered: false,
          registered_user_id: null,
          registered_at: null,
        })
        .eq('id', updatedExistingWhitelistId)
        .then(() => {}, () => {});
    }
    await supabaseAdmin.auth.admin.deleteUser(createdUserId).catch(() => {});

    const message = err instanceof Error ? err.message : 'Failed to synchronize student account.';
    sendJson(res, 500, { error: `Student provisioning rolled back: ${message}` });
  }
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await provisionSupabaseStudent(req, res);
}
