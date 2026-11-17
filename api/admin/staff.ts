import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

type StaffRole = 'nurse' | 'lab' | 'pharmacy' | 'doctor' | 'admin';

const ALLOWED_STAFF_ROLES = new Set<StaffRole>(['nurse', 'lab', 'pharmacy', 'doctor', 'admin']);
const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEAK_PASSWORDS = new Set(['123456', 'password', 'qwerty']);

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

export async function provisionSupabaseStaff(
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

  const env = resolveSupabaseAdminEnv();
  if (!env) {
    sendJson(res, 503, {
      error:
        'Server-side Supabase Admin provisioning is not configured. Set valid SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in server environment variables.',
    });
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

  // 1. Verify caller's Supabase Auth JWT and confirm active admin role in PostgreSQL
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

  if (callerRoleRes.data?.role !== 'admin') {
    sendJson(res, 403, { error: 'Only System Administrators can provision staff accounts.' });
    return;
  }

  // 2. Validate payload fields strictly
  const fullName = String(body.full_name || '').trim();
  const normalizedEmail = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');
  const role = String(body.role || '').trim() as StaffRole;
  const phone = body.phone ? String(body.phone).trim() : null;
  const requestedDeptId = body.department_id ? String(body.department_id).trim() : null;
  const specialization = body.specialization ? String(body.specialization).trim() : null;
  const consultationRoom = body.consultation_room ? String(body.consultation_room).trim() : null;

  if (!fullName || !normalizedEmail || !password || !role) {
    sendJson(res, 400, {
      error: 'Full name, email, temporary password, and staff role are required.',
    });
    return;
  }
  if (!VALID_EMAIL_REGEX.test(normalizedEmail)) {
    sendJson(res, 400, { error: 'Please enter a valid institutional email address.' });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    sendJson(res, 400, { error: 'Temporary password must be between 6 and 128 characters.' });
    return;
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    sendJson(res, 400, { error: 'Please choose a stronger temporary password.' });
    return;
  }
  if (!ALLOWED_STAFF_ROLES.has(role)) {
    sendJson(res, 400, {
      error: 'Invalid staff role selected. Allowed roles: nurse, lab, pharmacy, doctor, admin.',
    });
    return;
  }

  // 3. Resolve department upfront if role is doctor
  let resolvedDepartmentId: string | null = null;
  let doctorCount = 0;
  if (role === 'doctor') {
    if (requestedDeptId) {
      const { data: deptRow, error: deptErr } = await supabaseAdmin
        .from('departments')
        .select('id, is_active')
        .eq('id', requestedDeptId)
        .maybeSingle();
      if (deptErr || !deptRow || !deptRow.is_active) {
        sendJson(res, 400, { error: 'Selected clinical department is invalid or inactive.' });
        return;
      }
      resolvedDepartmentId = deptRow.id;
    } else {
      const { data: firstDept, error: firstDeptErr } = await supabaseAdmin
        .from('departments')
        .select('id')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstDeptErr || !firstDept) {
        sendJson(res, 400, {
          error: 'No active clinical department available to assign this doctor.',
        });
        return;
      }
      resolvedDepartmentId = firstDept.id;
    }

    const { count } = await supabaseAdmin
      .from('doctors')
      .select('id', { count: 'exact', head: true });
    doctorCount = count ?? 0;
  }

  // 4. Create Auth user via Supabase Admin API (service_role key)
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
    },
  });

  if (createAuthErr || !createdAuth.user) {
    const msg = createAuthErr?.message || 'Unable to create staff account in Supabase Auth.';
    const status = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists') ? 409 : 400;
    sendJson(res, status, { error: msg });
    return;
  }

  const createdUserId = createdAuth.user.id;

  // 5. Reassign role from trigger-default 'patient' to target staff role, remove auto-patient row, and update profile
  try {
    const { error: roleErr } = await supabaseAdmin
      .from('user_roles')
      .upsert(
        {
          user_id: createdUserId,
          role,
          assigned_by: callerUser.id,
        },
        { onConflict: 'user_id' }
      );
    if (roleErr) {
      throw new Error(roleErr.message);
    }

    const { error: delPatientErr } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('profile_id', createdUserId);
    if (delPatientErr) {
      throw new Error(delPatientErr.message);
    }

    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName,
        phone,
        address: 'FUDMA Healthcenter Staff',
        is_active: true,
      })
      .eq('id', createdUserId);
    if (profileErr) {
      throw new Error(profileErr.message);
    }

    if (role === 'doctor' && resolvedDepartmentId) {
      const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const staffCode = `FUDMA-MD-${String(doctorCount + 1).padStart(3, '0')}-${suffix}`;
      const { error: docErr } = await supabaseAdmin.from('doctors').insert({
        profile_id: createdUserId,
        department_id: resolvedDepartmentId,
        staff_code: staffCode,
        specialization: specialization || 'General Medical Officer',
        consultation_room: consultationRoom || `Consult Room ${doctorCount + 1}`,
        is_available: true,
      });
      if (docErr) {
        throw new Error(docErr.message);
      }
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: callerUser.id,
      actor_name: callerProfileRes.data.full_name,
      actor_role: 'admin',
      action: 'STAFF_CREATED',
      entity_type: 'profile',
      entity_id: normalizedEmail,
      details: `Provisioned ${role} account for ${fullName} via Supabase Admin API.`,
    });

    sendJson(res, 201, { ok: true, user_id: createdUserId });
  } catch (err) {
    // Roll back the created auth user cleanly on partial failure
    await supabaseAdmin.auth.admin.deleteUser(createdUserId).catch(() => {});
    const message = err instanceof Error ? err.message : 'Failed to finalize staff profile.';
    sendJson(res, 500, { error: `Staff provisioning rolled back: ${message}` });
  }
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await provisionSupabaseStaff(req, res);
}
