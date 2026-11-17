import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPER_ADMIN_USERNAME = 'ENG/2011/0001';
const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_MATRIC_REGEX = /^[A-Z0-9]+\/\d{4}\/\d+$/;
const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GENDERS = new Set(['Male', 'Female', 'Other']);
const ALLOWED_BLOOD_GROUPS = new Set(['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const ALLOWED_GENOTYPES = new Set(['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC']);
const WEAK_PASSWORDS = new Set(['123456', 'password', 'qwerty', '12345678', 'abcdef']);
const MAX_BULK_IMPORT_ROWS = 250;

export interface ServerlessRequest extends IncomingMessage {
  method?: string;
  url?: string;
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
    if (chunks.reduce((sum, b) => sum + b.length, 0) > 2 * 1024 * 1024) {
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

function normalizeGender(value: unknown): 'Male' | 'Female' | 'Other' | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'male' || raw === 'm') return 'Male';
  if (raw === 'female' || raw === 'f') return 'Female';
  if (raw === 'other') return 'Other';
  return String(value ?? '').trim() as 'Male' | 'Female' | 'Other';
}

function normalizeBloodGroup(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw || raw === 'UNKNOWN') return 'Unknown';
  return raw;
}

function normalizeGenotype(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw || raw === 'UNKNOWN') return 'Unknown';
  return raw;
}

function isValidCalendarDate(dateStr: string): boolean {
  if (!VALID_DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function generateSecureStudentPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%';
  const all = upper + lower + digits + symbols;

  const chars = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = 4; i < 12; i += 1) {
    chars.push(all[crypto.randomInt(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
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

type AdminClient = SupabaseClient<any, 'public', any>;

interface NormalizedStudentInput {
  full_name: string;
  matric_number: string;
  department: string;
  email: string;
  password: string;
  has_custom_password: boolean;
  phone: string | null;
  gender: 'Male' | 'Female' | 'Other' | null;
  date_of_birth: string | null;
  address: string | null;
  blood_group: string;
  genotype: string;
  allergies: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

function validateStudentInput(
  raw: Record<string, unknown>,
  options: { requirePassword: boolean }
): { errors: string[]; normalized: NormalizedStudentInput } {
  const errors: string[] = [];
  const fullName = String(raw.full_name || '').trim();
  const normMatric = normalizeMatric(raw.matric_number);
  const department = String(raw.department || raw.faculty_or_unit || '').trim();
  const normalizedEmail = String(raw.email || '').trim().toLowerCase();
  const rawPassword = raw.password !== undefined && raw.password !== null ? String(raw.password) : '';
  const trimmedPassword = rawPassword.trim();
  const phone = raw.phone ? String(raw.phone).trim() : null;
  const gender = normalizeGender(raw.gender);
  const dobRaw = raw.date_of_birth ? String(raw.date_of_birth).trim() : null;
  const address = raw.address ? String(raw.address).trim() : null;
  const bloodGroup = normalizeBloodGroup(raw.blood_group);
  const genotype = normalizeGenotype(raw.genotype);
  const allergies = raw.allergies ? String(raw.allergies).trim() : 'None reported';
  const emergencyName = raw.emergency_contact_name ? String(raw.emergency_contact_name).trim() : null;
  const emergencyPhone = raw.emergency_contact_phone ? String(raw.emergency_contact_phone).trim() : null;

  if (!fullName || fullName.length < 2 || fullName.length > 120) {
    errors.push('Full name must be between 2 and 120 characters.');
  }
  if (!normMatric || !VALID_MATRIC_REGEX.test(normMatric)) {
    errors.push('Matriculation number must match format e.g. ENG/2024/32094.');
  }
  if (normMatric === SUPER_ADMIN_USERNAME) {
    errors.push(`${SUPER_ADMIN_USERNAME} is reserved for the Super Administrator.`);
  }
  if (!department) {
    errors.push('Academic department is required.');
  }
  if (!normalizedEmail || !VALID_EMAIL_REGEX.test(normalizedEmail)) {
    errors.push('Valid student email address is required.');
  }

  let effectivePassword = rawPassword;
  const hasCustomPassword = trimmedPassword.length > 0;
  if (options.requirePassword) {
    if (!rawPassword || rawPassword.length < 6 || rawPassword.length > 128) {
      errors.push('Password must be between 6 and 128 characters.');
    } else if (WEAK_PASSWORDS.has(rawPassword.toLowerCase())) {
      errors.push('Password is too weak.');
    }
  } else if (hasCustomPassword) {
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      errors.push('Custom password must be between 6 and 128 characters.');
    } else if (WEAK_PASSWORDS.has(rawPassword.toLowerCase())) {
      errors.push('Custom password is too weak.');
    }
  } else {
    effectivePassword = '';
  }

  if (gender && !ALLOWED_GENDERS.has(gender)) {
    errors.push('Gender must be Male, Female, or Other.');
  }
  if (dobRaw && !isValidCalendarDate(dobRaw)) {
    errors.push('Date of birth must be YYYY-MM-DD.');
  }
  if (!ALLOWED_BLOOD_GROUPS.has(bloodGroup)) {
    errors.push('Invalid blood group.');
  }
  if (!ALLOWED_GENOTYPES.has(genotype)) {
    errors.push('Invalid genotype.');
  }

  return {
    errors,
    normalized: {
      full_name: fullName,
      matric_number: normMatric,
      department,
      email: normalizedEmail,
      password: effectivePassword,
      has_custom_password: hasCustomPassword,
      phone,
      gender: gender && ALLOWED_GENDERS.has(gender) ? gender : null,
      date_of_birth: dobRaw && isValidCalendarDate(dobRaw) ? dobRaw : null,
      address,
      blood_group: ALLOWED_BLOOD_GROUPS.has(bloodGroup) ? bloodGroup : 'Unknown',
      genotype: ALLOWED_GENOTYPES.has(genotype) ? genotype : 'Unknown',
      allergies: allergies || 'None reported',
      emergency_contact_name: emergencyName,
      emergency_contact_phone: emergencyPhone,
    },
  };
}

async function listAllAuthEmails(supabaseAdmin: AdminClient): Promise<Set<string>> {
  const emails = new Set<string>();
  let page = 1;
  const perPage = 1000;
  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (u.email) emails.add(u.email.trim().toLowerCase());
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return emails;
}

async function provisionSingleSynchronizedStudent(
  supabaseAdmin: AdminClient,
  caller: { id: string; full_name: string; role: string },
  input: NormalizedStudentInput,
  existingUnclaimedWhitelistId: string | null,
  options: { writeAuditLog: boolean }
): Promise<{
  student: Record<string, unknown>;
  hospital_number: string;
  user_id: string;
}> {
  const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      account_origin: 'admin_staff',
    },
    user_metadata: {
      full_name: input.full_name,
      phone: input.phone,
      matric_or_staff_id: input.matric_number,
      patient_category: 'Student',
    },
  });

  if (createAuthErr || !createdAuth.user) {
    throw new Error(createAuthErr?.message || 'Unable to create student account in Supabase Auth.');
  }

  const createdUserId = createdAuth.user.id;
  const nowIso = new Date().toISOString();
  const hospitalNumber = generateHospitalNumber(createdUserId);
  let insertedNewWhitelistId: string | null = null;
  let updatedExistingWhitelistId: string | null = null;

  try {
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
      {
        id: createdUserId,
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        gender: input.gender,
        date_of_birth: input.date_of_birth,
        address: input.address,
        is_active: true,
      },
      { onConflict: 'id' }
    );
    if (profErr) throw new Error(profErr.message);

    const { error: roleErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: createdUserId,
        role: 'patient',
        assigned_by: caller.id,
      },
      { onConflict: 'user_id' }
    );
    if (roleErr) throw new Error(roleErr.message);

    if (existingUnclaimedWhitelistId) {
      const { error: wlUpdErr } = await supabaseAdmin
        .from('group11_student_whitelist')
        .update({
          full_name: input.full_name,
          department: input.department,
          is_registered: true,
          registered_user_id: createdUserId,
          registered_at: nowIso,
        })
        .eq('id', existingUnclaimedWhitelistId);
      if (wlUpdErr) throw new Error(wlUpdErr.message);
      updatedExistingWhitelistId = existingUnclaimedWhitelistId;
    } else {
      const { data: wlIns, error: wlInsErr } = await supabaseAdmin
        .from('group11_student_whitelist')
        .insert({
          full_name: input.full_name,
          matric_number: input.matric_number,
          department: input.department,
          is_registered: true,
          registered_user_id: createdUserId,
          registered_at: nowIso,
        })
        .select('id')
        .single();
      if (wlInsErr || !wlIns) throw new Error(wlInsErr?.message || 'Whitelist sync failed.');
      insertedNewWhitelistId = String(wlIns.id);
    }

    const { data: patRow, error: patErr } = await supabaseAdmin
      .from('patients')
      .insert({
        profile_id: createdUserId,
        hospital_number: hospitalNumber,
        matric_or_staff_id: input.matric_number,
        patient_category: 'Student',
        faculty_or_unit: input.department,
        blood_group: input.blood_group,
        genotype: input.genotype,
        allergies: input.allergies,
        emergency_contact_name: input.emergency_contact_name,
        emergency_contact_phone: input.emergency_contact_phone,
        is_walk_in: false,
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        gender: input.gender,
        date_of_birth: input.date_of_birth,
        address: input.address,
      })
      .select('*')
      .single();

    if (patErr || !patRow) {
      throw new Error(patErr?.message || 'Unable to create synchronized patient medical file.');
    }

    await supabaseAdmin.from('notifications').insert({
      recipient_user_id: createdUserId,
      title: 'Welcome to FUDMA HEALTHCENTER',
      message: `Your student portal account (${hospitalNumber}) for ${input.matric_number} was provisioned by Super Administration.`,
      category: 'account',
    });

    if (options.writeAuditLog) {
      await supabaseAdmin.from('activity_logs').insert({
        actor_id: caller.id,
        actor_name: caller.full_name,
        actor_role: caller.role,
        action: 'ADMIN_STUDENT_CREATED',
        entity_type: 'patient',
        entity_id: hospitalNumber,
        details: `Provisioned & synced student portal account for ${input.full_name} (${input.matric_number}, ${input.department}).`,
      });
    }

    return {
      user_id: createdUserId,
      hospital_number: hospitalNumber,
      student: {
        user_id: createdUserId,
        patient_id: String(patRow.id),
        hospital_number: hospitalNumber,
        matric_number: input.matric_number,
        full_name: input.full_name,
        email: input.email,
        department: input.department,
        phone: input.phone,
        gender: input.gender,
        date_of_birth: input.date_of_birth,
        address: input.address,
        blood_group: input.blood_group,
        genotype: input.genotype,
        allergies: input.allergies,
        emergency_contact_name: input.emergency_contact_name,
        emergency_contact_phone: input.emergency_contact_phone,
        is_active: true,
        is_walk_in: false,
        is_whitelisted: true,
        has_auth_account: true,
        created_at: String(patRow.created_at || nowIso),
        updated_at: String(patRow.updated_at || nowIso),
      },
    };
  } catch (err) {
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
    throw err;
  }
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

  if (
    req.method !== 'GET' &&
    req.method !== 'POST' &&
    req.method !== 'PUT' &&
    req.method !== 'PATCH'
  ) {
    sendJson(res, 405, { error: 'Method not allowed. Use GET, POST, PUT, or PATCH.' });
    return;
  }

  const env = resolveSupabaseAdminEnv();
  if (!env.ok) {
    sendJson(res, 503, { error: env.error });
    return;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { error: 'Super Administrator Bearer token is required.' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (req.method !== 'GET') {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Malformed JSON request payload.' });
      return;
    }
  }

  let supabaseAdmin: AdminClient;
  try {
    supabaseAdmin = createClient<any>(env.url, env.serviceRoleKey, {
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

  // 1. Authenticate caller JWT & verify active SUPER ADMIN role exclusively
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
    sendJson(res, 500, { error: 'Unable to verify Super Administrator privileges.' });
    return;
  }

  if (!callerProfileRes.data || !callerProfileRes.data.is_active) {
    sendJson(res, 403, { error: 'Administrator account is inactive.' });
    return;
  }

  const callerRole = String(callerRoleRes.data?.role || '');
  if (callerRole !== 'super_admin') {
    sendJson(res, 403, {
      error: 'Access denied. Only the Super Administrator may access Student Management.',
    });
    return;
  }

  const callerActor = {
    id: callerUser.id,
    full_name: String(callerProfileRes.data.full_name || 'Super Administrator'),
    role: callerRole,
  };

  // =========================================================================
  // GET: List all student accounts OR fetch complete student detail profile
  // =========================================================================
  if (req.method === 'GET') {
    const parsedUrl = new URL(req.url || '/api/admin/students', 'http://localhost');
    const detailPatientId = parsedUrl.searchParams.get('patient_id')?.trim() || '';

    if (detailPatientId) {
      const { data: pat, error: patErr } = await supabaseAdmin
        .from('patients')
        .select('*')
        .eq('id', detailPatientId)
        .eq('patient_category', 'Student')
        .maybeSingle();

      if (patErr || !pat) {
        sendJson(res, 404, { error: 'Student record not found.' });
        return;
      }

      const profileId = pat.profile_id ? String(pat.profile_id) : null;
      const [
        profRes,
        wlRes,
        apptsRes,
        vitalsRes,
        consRes,
        labsRes,
        rxRes,
      ] = await Promise.all([
        profileId
          ? supabaseAdmin.from('profiles').select('*').eq('id', profileId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        profileId
          ? supabaseAdmin
              .from('group11_student_whitelist')
              .select('id, is_registered, matric_number')
              .eq('registered_user_id', profileId)
              .maybeSingle()
          : pat.matric_or_staff_id
            ? supabaseAdmin
                .from('group11_student_whitelist')
                .select('id, is_registered, matric_number')
                .eq('matric_number', normalizeMatric(pat.matric_or_staff_id))
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('appointments')
          .select('id, appointment_code, consultation_category, appointment_date, appointment_time, status', {
            count: 'exact',
          })
          .eq('patient_id', detailPatientId)
          .order('appointment_date', { ascending: false })
          .limit(5),
        supabaseAdmin
          .from('patient_vitals')
          .select('id', { count: 'exact', head: true })
          .eq('patient_id', detailPatientId),
        supabaseAdmin
          .from('consultations')
          .select('id, diagnosis, status, created_at', { count: 'exact' })
          .eq('patient_id', detailPatientId)
          .order('created_at', { ascending: false })
          .limit(5),
        supabaseAdmin
          .from('laboratory_requests')
          .select('id', { count: 'exact', head: true })
          .eq('patient_id', detailPatientId),
        supabaseAdmin
          .from('prescriptions')
          .select('id, prescription_code, status, created_at', { count: 'exact' })
          .eq('patient_id', detailPatientId)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      const prof = profRes.data as Record<string, unknown> | null;
      const detail = {
        user_id: profileId,
        patient_id: String(pat.id),
        hospital_number: String(pat.hospital_number),
        matric_number: pat.matric_or_staff_id ? String(pat.matric_or_staff_id) : null,
        full_name: String(prof?.full_name || pat.full_name || 'Student'),
        email: (prof?.email ?? pat.email ?? null) ? String(prof?.email ?? pat.email) : null,
        department: pat.faculty_or_unit ? String(pat.faculty_or_unit) : null,
        phone: (prof?.phone ?? pat.phone ?? null) ? String(prof?.phone ?? pat.phone) : null,
        gender: (prof?.gender ?? pat.gender ?? null) as 'Male' | 'Female' | 'Other' | null,
        date_of_birth: (prof?.date_of_birth ?? pat.date_of_birth ?? null)
          ? String(prof?.date_of_birth ?? pat.date_of_birth)
          : null,
        address: (prof?.address ?? pat.address ?? null) ? String(prof?.address ?? pat.address) : null,
        blood_group: pat.blood_group ? String(pat.blood_group) : 'Unknown',
        genotype: pat.genotype ? String(pat.genotype) : 'Unknown',
        allergies: pat.allergies ? String(pat.allergies) : null,
        emergency_contact_name: pat.emergency_contact_name ? String(pat.emergency_contact_name) : null,
        emergency_contact_phone: pat.emergency_contact_phone ? String(pat.emergency_contact_phone) : null,
        is_active: prof ? Boolean(prof.is_active) : false,
        is_walk_in: Boolean(pat.is_walk_in),
        is_whitelisted: Boolean(wlRes.data),
        has_auth_account: Boolean(profileId),
        created_at: String(pat.created_at),
        updated_at: String(prof?.updated_at || pat.updated_at || pat.created_at),
        clinical_summary: {
          appointments_count: apptsRes.count ?? 0,
          vitals_count: vitalsRes.count ?? 0,
          consultations_count: consRes.count ?? 0,
          lab_requests_count: labsRes.count ?? 0,
          prescriptions_count: rxRes.count ?? 0,
        },
        recent_appointments: apptsRes.data || [],
        recent_consultations: consRes.data || [],
        recent_prescriptions: rxRes.data || [],
      };

      sendJson(res, 200, { student: detail });
      return;
    }

    const [patientsRes, profilesRes, wlRes] = await Promise.all([
      supabaseAdmin
        .from('patients')
        .select('*')
        .eq('patient_category', 'Student')
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, full_name, email, phone, gender, date_of_birth, address, is_active, updated_at'),
      supabaseAdmin.from('group11_student_whitelist').select('matric_number, registered_user_id, is_registered'),
    ]);

    if (patientsRes.error || profilesRes.error) {
      sendJson(res, 500, { error: 'Unable to load student accounts directory.' });
      return;
    }

    const profileMap = new Map(
      (profilesRes.data || []).map((p) => [String(p.id), p as Record<string, unknown>])
    );
    const wlUserSet = new Set(
      (wlRes.data || [])
        .map((w) => (w.registered_user_id ? String(w.registered_user_id) : ''))
        .filter(Boolean)
    );
    const wlMatricSet = new Set(
      (wlRes.data || []).map((w) => normalizeMatric(w.matric_number)).filter(Boolean)
    );

    const students = (patientsRes.data || []).map((pat) => {
      const profileId = pat.profile_id ? String(pat.profile_id) : null;
      const prof = profileId ? profileMap.get(profileId) : null;
      const normMatric = pat.matric_or_staff_id ? normalizeMatric(pat.matric_or_staff_id) : null;
      return {
        user_id: profileId,
        patient_id: String(pat.id),
        hospital_number: String(pat.hospital_number),
        matric_number: normMatric,
        full_name: String(prof?.full_name || pat.full_name || 'Student'),
        email: (prof?.email ?? pat.email ?? null) ? String(prof?.email ?? pat.email) : null,
        department: pat.faculty_or_unit ? String(pat.faculty_or_unit) : null,
        phone: (prof?.phone ?? pat.phone ?? null) ? String(prof?.phone ?? pat.phone) : null,
        gender: (prof?.gender ?? pat.gender ?? null) as 'Male' | 'Female' | 'Other' | null,
        date_of_birth: (prof?.date_of_birth ?? pat.date_of_birth ?? null)
          ? String(prof?.date_of_birth ?? pat.date_of_birth)
          : null,
        address: (prof?.address ?? pat.address ?? null) ? String(prof?.address ?? pat.address) : null,
        blood_group: pat.blood_group ? String(pat.blood_group) : 'Unknown',
        genotype: pat.genotype ? String(pat.genotype) : 'Unknown',
        allergies: pat.allergies ? String(pat.allergies) : null,
        emergency_contact_name: pat.emergency_contact_name ? String(pat.emergency_contact_name) : null,
        emergency_contact_phone: pat.emergency_contact_phone ? String(pat.emergency_contact_phone) : null,
        is_active: prof ? Boolean(prof.is_active) : false,
        is_walk_in: Boolean(pat.is_walk_in),
        is_whitelisted: Boolean(
          (profileId && wlUserSet.has(profileId)) || (normMatric && wlMatricSet.has(normMatric))
        ),
        has_auth_account: Boolean(profileId),
        created_at: String(pat.created_at),
        updated_at: String(prof?.updated_at || pat.updated_at || pat.created_at),
      };
    });

    const totalStudents = students.length;
    const activeStudents = students.filter((s) => s.is_active).length;
    const inactiveStudents = totalStudents - activeStudents;

    sendJson(res, 200, {
      students,
      stats: {
        total_students: totalStudents,
        active_students: activeStudents,
        inactive_students: inactiveStudents,
      },
    });
    return;
  }

  // =========================================================================
  // PATCH: Activate or Deactivate student account (preserves clinical history)
  // =========================================================================
  if (req.method === 'PATCH') {
    const targetUserId = String(body.user_id || '').trim();
    const isActive = body.is_active;
    if (!targetUserId || typeof isActive !== 'boolean') {
      sendJson(res, 400, { error: 'user_id and boolean is_active are required.' });
      return;
    }

    const [targetRoleRes, targetProfRes, targetPrivRes] = await Promise.all([
      supabaseAdmin.from('user_roles').select('role').eq('user_id', targetUserId).maybeSingle(),
      supabaseAdmin.from('profiles').select('id, full_name, email, is_active').eq('id', targetUserId).maybeSingle(),
      supabaseAdmin.from('privileged_accounts').select('id').eq('user_id', targetUserId).maybeSingle(),
    ]);

    if (targetRoleRes.error || targetProfRes.error || !targetProfRes.data) {
      sendJson(res, 404, { error: 'Student account profile not found.' });
      return;
    }
    if (targetPrivRes.data || targetRoleRes.data?.role === 'super_admin') {
      sendJson(res, 403, { error: 'Privileged Super Administrator accounts cannot be modified here.' });
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

    // Enforce Auth-level ban / unban so deactivated sessions cannot refresh or sign in,
    // while reactivation restores the exact existing account cleanly without duplicates.
    const { error: authBanErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      ban_duration: isActive ? 'none' : '876000h',
    });

    if (authBanErr) {
      // Roll back profile is_active so DB and Auth state never diverge
      await supabaseAdmin
        .from('profiles')
        .update({ is_active: targetProfRes.data.is_active })
        .eq('id', targetUserId)
        .then(() => {}, () => {});
      sendJson(res, 500, {
        error: authBanErr.message || 'Unable to synchronize Supabase Auth suspension status.',
      });
      return;
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: callerActor.id,
      actor_name: callerActor.full_name,
      actor_role: callerActor.role,
      action: isActive ? 'STUDENT_ACCOUNT_ACTIVATED' : 'STUDENT_ACCOUNT_DEACTIVATED',
      entity_type: 'profile',
      entity_id: targetProfRes.data.email,
      details: `${isActive ? 'Activated' : 'Deactivated'} student portal access for ${targetProfRes.data.full_name}.`,
    });

    sendJson(res, 200, { ok: true, user_id: targetUserId, is_active: isActive });
    return;
  }

  // =========================================================================
  // PUT: Edit & synchronize existing student profile across DB & Auth
  // =========================================================================
  if (req.method === 'PUT') {
    const patientId = String(body.patient_id || '').trim();
    if (!patientId) {
      sendJson(res, 400, { error: 'patient_id is required to update a student record.' });
      return;
    }

    const { data: existingPat, error: patLookupErr } = await supabaseAdmin
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .eq('patient_category', 'Student')
      .maybeSingle();

    if (patLookupErr || !existingPat) {
      sendJson(res, 404, { error: 'Student patient record not found.' });
      return;
    }

    const { errors, normalized } = validateStudentInput(body, { requirePassword: false });
    if (errors.length > 0) {
      sendJson(res, 400, { error: errors[0] });
      return;
    }

    const linkedUserId = existingPat.profile_id ? String(existingPat.profile_id) : null;

    if (linkedUserId) {
      const [roleRes, privRes] = await Promise.all([
        supabaseAdmin.from('user_roles').select('role').eq('user_id', linkedUserId).maybeSingle(),
        supabaseAdmin.from('privileged_accounts').select('id').eq('user_id', linkedUserId).maybeSingle(),
      ]);
      if (privRes.data || roleRes.data?.role === 'super_admin') {
        sendJson(res, 403, { error: 'Protected Super Administrator accounts cannot be edited here.' });
        return;
      }
      if (roleRes.data?.role && roleRes.data.role !== 'patient') {
        sendJson(res, 403, { error: 'Only student patient accounts may be edited here.' });
        return;
      }
    }

    const [privCheck, dupMatricPat, dupWlRes, dupEmailProf] = await Promise.all([
      supabaseAdmin
        .from('privileged_accounts')
        .select('id')
        .eq('login_username', normalized.matric_number)
        .maybeSingle(),
      supabaseAdmin
        .from('patients')
        .select('id')
        .eq('matric_or_staff_id', normalized.matric_number)
        .neq('id', patientId)
        .maybeSingle(),
      supabaseAdmin
        .from('group11_student_whitelist')
        .select('id, is_registered, registered_user_id')
        .eq('matric_number', normalized.matric_number)
        .maybeSingle(),
      supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', normalized.email)
        .maybeSingle(),
    ]);

    if (privCheck.data) {
      sendJson(res, 403, { error: 'This matriculation number belongs to a privileged account.' });
      return;
    }
    if (dupMatricPat.data) {
      sendJson(res, 409, {
        error: `Matriculation number ${normalized.matric_number} is already assigned to another patient record.`,
      });
      return;
    }
    if (
      dupWlRes.data &&
      dupWlRes.data.registered_user_id &&
      dupWlRes.data.registered_user_id !== linkedUserId
    ) {
      sendJson(res, 409, {
        error: `Matriculation number ${normalized.matric_number} is already claimed by another student account.`,
      });
      return;
    }
    if (dupEmailProf.data && dupEmailProf.data.id !== linkedUserId) {
      sendJson(res, 409, { error: 'Another account already uses this student email address.' });
      return;
    }

    let currentProfile: Record<string, unknown> | null = null;
    if (linkedUserId) {
      const { data: profData } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', linkedUserId)
        .maybeSingle();
      currentProfile = profData as Record<string, unknown> | null;

      const currentEmail = String(currentProfile?.email || existingPat.email || '').trim().toLowerCase();
      const emailChanged = currentEmail !== normalized.email;

      const { error: authUpdErr } = await supabaseAdmin.auth.admin.updateUserById(linkedUserId, {
        ...(emailChanged ? { email: normalized.email, email_confirm: true } : {}),
        user_metadata: {
          full_name: normalized.full_name,
          phone: normalized.phone,
          matric_or_staff_id: normalized.matric_number,
          patient_category: 'Student',
        },
      });
      if (authUpdErr) {
        sendJson(res, 400, {
          error: authUpdErr.message || 'Unable to synchronize student identity with Supabase Auth.',
        });
        return;
      }

      const { error: profUpdErr } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: normalized.full_name,
          email: normalized.email,
          phone: normalized.phone,
          gender: normalized.gender,
          date_of_birth: normalized.date_of_birth,
          address: normalized.address,
        })
        .eq('id', linkedUserId);
      if (profUpdErr) {
        sendJson(res, 500, { error: profUpdErr.message || 'Unable to update student profile.' });
        return;
      }
    }

    const { data: updatedPat, error: patUpdErr } = await supabaseAdmin
      .from('patients')
      .update({
        full_name: normalized.full_name,
        email: normalized.email,
        phone: normalized.phone,
        gender: normalized.gender,
        date_of_birth: normalized.date_of_birth,
        address: normalized.address,
        matric_or_staff_id: normalized.matric_number,
        faculty_or_unit: normalized.department,
        blood_group: normalized.blood_group,
        genotype: normalized.genotype,
        allergies: normalized.allergies,
        emergency_contact_name: normalized.emergency_contact_name,
        emergency_contact_phone: normalized.emergency_contact_phone,
      })
      .eq('id', patientId)
      .select('*')
      .single();

    if (patUpdErr || !updatedPat) {
      sendJson(res, 500, { error: patUpdErr?.message || 'Unable to update student clinical file.' });
      return;
    }

    // Sync Group 11 whitelist non-destructively so matric login continues working if matric/name/dept changed
    if (linkedUserId) {
      const { data: ownWl } = await supabaseAdmin
        .from('group11_student_whitelist')
        .select('id')
        .eq('registered_user_id', linkedUserId)
        .maybeSingle();

      if (ownWl?.id) {
        const { error: wlSyncErr } = await supabaseAdmin
          .from('group11_student_whitelist')
          .update({
            full_name: normalized.full_name,
            matric_number: normalized.matric_number,
            department: normalized.department,
          })
          .eq('id', ownWl.id);
        if (wlSyncErr) {
          sendJson(res, 500, { error: wlSyncErr.message || 'Unable to synchronize whitelist matric record.' });
          return;
        }
      } else if (dupWlRes.data?.id && !dupWlRes.data.registered_user_id) {
        await supabaseAdmin
          .from('group11_student_whitelist')
          .update({
            full_name: normalized.full_name,
            department: normalized.department,
            is_registered: true,
            registered_user_id: linkedUserId,
            registered_at: new Date().toISOString(),
          })
          .eq('id', dupWlRes.data.id);
      } else {
        await supabaseAdmin.from('group11_student_whitelist').insert({
          full_name: normalized.full_name,
          matric_number: normalized.matric_number,
          department: normalized.department,
          is_registered: true,
          registered_user_id: linkedUserId,
          registered_at: new Date().toISOString(),
        });
      }
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: callerActor.id,
      actor_name: callerActor.full_name,
      actor_role: callerActor.role,
      action: 'ADMIN_STUDENT_UPDATED',
      entity_type: 'patient',
      entity_id: String(updatedPat.hospital_number),
      details: `Updated student profile for ${normalized.full_name} (${normalized.matric_number}, ${normalized.department}).`,
    });

    sendJson(res, 200, {
      ok: true,
      student: {
        user_id: linkedUserId,
        patient_id: String(updatedPat.id),
        hospital_number: String(updatedPat.hospital_number),
        matric_number: normalized.matric_number,
        full_name: normalized.full_name,
        email: normalized.email,
        department: normalized.department,
        phone: normalized.phone,
        gender: normalized.gender,
        date_of_birth: normalized.date_of_birth,
        address: normalized.address,
        blood_group: normalized.blood_group,
        genotype: normalized.genotype,
        allergies: normalized.allergies,
        emergency_contact_name: normalized.emergency_contact_name,
        emergency_contact_phone: normalized.emergency_contact_phone,
        is_active: currentProfile ? Boolean(currentProfile.is_active) : false,
        is_walk_in: Boolean(updatedPat.is_walk_in),
        is_whitelisted: Boolean(linkedUserId),
        has_auth_account: Boolean(linkedUserId),
        created_at: String(updatedPat.created_at),
        updated_at: String(updatedPat.updated_at || new Date().toISOString()),
      },
    });
    return;
  }

  // =========================================================================
  // POST: Single creation OR bulk_preview OR bulk_import
  // =========================================================================
  const action = String(body.action || 'create').trim();

  if (action === 'bulk_preview' || action === 'bulk_import') {
    const rawRows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : null;
    if (!rawRows || rawRows.length === 0) {
      sendJson(res, 400, { error: 'Upload at least one student row before running bulk import.' });
      return;
    }
    if (rawRows.length > MAX_BULK_IMPORT_ROWS) {
      sendJson(res, 400, {
        error: `Maximum ${MAX_BULK_IMPORT_ROWS} rows permitted per bulk import batch.`,
      });
      return;
    }

    const [privRes, wlRes, patientsRes, profilesRes, authEmailSet] = await Promise.all([
      supabaseAdmin.from('privileged_accounts').select('login_username'),
      supabaseAdmin
        .from('group11_student_whitelist')
        .select('id, matric_number, is_registered, registered_user_id'),
      supabaseAdmin.from('patients').select('matric_or_staff_id, email'),
      supabaseAdmin.from('profiles').select('email'),
      listAllAuthEmails(supabaseAdmin),
    ]);

    if (privRes.error || wlRes.error || patientsRes.error || profilesRes.error) {
      sendJson(res, 500, { error: 'Unable to verify existing student records for duplicate check.' });
      return;
    }

    const reservedUsernames = new Set<string>([SUPER_ADMIN_USERNAME]);
    for (const p of privRes.data || []) {
      reservedUsernames.add(normalizeMatric(p.login_username));
    }

    const existingMatrics = new Set<string>();
    const unclaimedWhitelistByMatric = new Map<string, string>();
    for (const w of wlRes.data || []) {
      const m = normalizeMatric(w.matric_number);
      if (!m) continue;
      if (w.is_registered || w.registered_user_id) {
        existingMatrics.add(m);
      } else {
        unclaimedWhitelistByMatric.set(m, String(w.id));
      }
    }
    for (const p of patientsRes.data || []) {
      const m = normalizeMatric(p.matric_or_staff_id);
      if (m) existingMatrics.add(m);
    }

    const existingEmails = new Set<string>(authEmailSet);
    for (const p of profilesRes.data || []) {
      if (p.email) existingEmails.add(String(p.email).trim().toLowerCase());
    }
    for (const p of patientsRes.data || []) {
      if (p.email) existingEmails.add(String(p.email).trim().toLowerCase());
    }

    const seenBatchMatrics = new Set<string>();
    const seenBatchEmails = new Set<string>();

    const evaluated = rawRows.map((row, idx) => {
      const rowNum = Number(row.row_number) || idx + 1;
      const { errors, normalized } = validateStudentInput(row, { requirePassword: false });
      const rowErrors = [...errors];
      let isDuplicate = false;

      if (normalized.matric_number) {
        if (reservedUsernames.has(normalized.matric_number)) {
          rowErrors.push('Reserved privileged username cannot be imported.');
        } else if (existingMatrics.has(normalized.matric_number)) {
          isDuplicate = true;
          rowErrors.push(`Matriculation number ${normalized.matric_number} already exists in database.`);
        } else if (seenBatchMatrics.has(normalized.matric_number)) {
          isDuplicate = true;
          rowErrors.push(`Duplicate matriculation number ${normalized.matric_number} within uploaded file.`);
        }
        seenBatchMatrics.add(normalized.matric_number);
      }

      if (normalized.email) {
        if (existingEmails.has(normalized.email)) {
          isDuplicate = true;
          rowErrors.push(`Email ${normalized.email} already exists in database.`);
        } else if (seenBatchEmails.has(normalized.email)) {
          isDuplicate = true;
          rowErrors.push(`Duplicate email ${normalized.email} within uploaded file.`);
        }
        seenBatchEmails.add(normalized.email);
      }

      const status: 'valid' | 'duplicate' | 'invalid' =
        rowErrors.length === 0 ? 'valid' : isDuplicate && errors.length === 0 ? 'duplicate' : isDuplicate ? 'duplicate' : 'invalid';

      return {
        row_number: rowNum,
        status,
        errors: rowErrors,
        normalized,
      };
    });

    if (action === 'bulk_preview') {
      sendJson(res, 200, {
        ok: true,
        rows: evaluated.map((item) => ({
          row_number: item.row_number,
          status: item.status,
          errors: item.errors,
          normalized: {
            full_name: item.normalized.full_name,
            matric_number: item.normalized.matric_number,
            department: item.normalized.department,
            email: item.normalized.email,
            has_custom_password: item.normalized.has_custom_password,
            phone: item.normalized.phone,
            gender: item.normalized.gender,
            date_of_birth: item.normalized.date_of_birth,
            address: item.normalized.address,
            blood_group: item.normalized.blood_group,
            genotype: item.normalized.genotype,
            allergies: item.normalized.allergies,
            emergency_contact_name: item.normalized.emergency_contact_name,
            emergency_contact_phone: item.normalized.emergency_contact_phone,
          },
        })),
      });
      return;
    }

    // Execute bulk_import (non-destructive: never overwrites or deletes existing rows)
    const results: Array<Record<string, unknown>> = [];
    let createdCount = 0;
    let skippedDupCount = 0;
    let failedCount = 0;

    for (const item of evaluated) {
      if (item.status === 'duplicate') {
        skippedDupCount += 1;
        results.push({
          row_number: item.row_number,
          full_name: item.normalized.full_name,
          matric_number: item.normalized.matric_number,
          email: item.normalized.email,
          department: item.normalized.department,
          status: 'skipped_duplicate',
          message: item.errors.join(' '),
        });
        continue;
      }

      if (item.status === 'invalid') {
        failedCount += 1;
        results.push({
          row_number: item.row_number,
          full_name: item.normalized.full_name,
          matric_number: item.normalized.matric_number,
          email: item.normalized.email,
          department: item.normalized.department,
          status: 'failed',
          message: item.errors.join(' '),
        });
        continue;
      }

      const assignedPassword = item.normalized.has_custom_password
        ? item.normalized.password
        : generateSecureStudentPassword();

      try {
        const unclaimedId = unclaimedWhitelistByMatric.get(item.normalized.matric_number) || null;
        const created = await provisionSingleSynchronizedStudent(
          supabaseAdmin,
          callerActor,
          { ...item.normalized, password: assignedPassword },
          unclaimedId,
          { writeAuditLog: false }
        );
        createdCount += 1;
        results.push({
          row_number: item.row_number,
          full_name: item.normalized.full_name,
          matric_number: item.normalized.matric_number,
          email: item.normalized.email,
          department: item.normalized.department,
          status: 'created',
          message: 'Student account created and synchronized.',
          hospital_number: created.hospital_number,
          generated_password: assignedPassword,
        });
      } catch (err) {
        failedCount += 1;
        results.push({
          row_number: item.row_number,
          full_name: item.normalized.full_name,
          matric_number: item.normalized.matric_number,
          email: item.normalized.email,
          department: item.normalized.department,
          status: 'failed',
          message: err instanceof Error ? err.message : 'Unable to provision student row.',
        });
      }
    }

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: callerActor.id,
      actor_name: callerActor.full_name,
      actor_role: callerActor.role,
      action: 'ADMIN_STUDENT_BULK_IMPORTED',
      entity_type: 'patient',
      entity_id: `BATCH-${rawRows.length}`,
      details: `Bulk student import completed: ${createdCount} created, ${skippedDupCount} duplicates skipped, ${failedCount} failed.`,
    });

    sendJson(res, 200, {
      ok: true,
      summary: {
        total: rawRows.length,
        created: createdCount,
        skipped_duplicate: skippedDupCount,
        failed: failedCount,
        results,
      },
    });
    return;
  }

  // Single student creation
  const { errors, normalized } = validateStudentInput(body, { requirePassword: true });
  if (errors.length > 0) {
    sendJson(res, normalized.matric_number === SUPER_ADMIN_USERNAME ? 403 : 400, { error: errors[0] });
    return;
  }

  const [privCheck, existingWlRes, existingPatientRes, existingProfEmailRes] = await Promise.all([
    supabaseAdmin
      .from('privileged_accounts')
      .select('id')
      .eq('login_username', normalized.matric_number)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id, is_registered, registered_user_id')
      .eq('matric_number', normalized.matric_number)
      .maybeSingle(),
    supabaseAdmin
      .from('patients')
      .select('id')
      .eq('matric_or_staff_id', normalized.matric_number)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', normalized.email)
      .maybeSingle(),
  ]);

  if (privCheck.data) {
    sendJson(res, 403, { error: 'This identifier belongs to a privileged account and cannot be assigned.' });
    return;
  }
  if (existingWlRes.data && (existingWlRes.data.is_registered || existingWlRes.data.registered_user_id)) {
    sendJson(res, 409, {
      error: `Matriculation number ${normalized.matric_number} is already registered in the portal.`,
    });
    return;
  }
  if (existingPatientRes.data) {
    sendJson(res, 409, {
      error: `A patient record already exists for matriculation number ${normalized.matric_number}.`,
    });
    return;
  }
  if (existingProfEmailRes.data) {
    sendJson(res, 409, { error: 'An account with this student email address already exists.' });
    return;
  }

  try {
    const created = await provisionSingleSynchronizedStudent(
      supabaseAdmin,
      callerActor,
      normalized,
      existingWlRes.data?.id ? String(existingWlRes.data.id) : null,
      { writeAuditLog: true }
    );
    sendJson(res, 201, {
      ok: true,
      student: created.student,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to synchronize student account.';
    const status = message.toLowerCase().includes('already') || message.toLowerCase().includes('exists') ? 409 : 500;
    sendJson(res, status, { error: status === 409 ? message : `Student provisioning rolled back: ${message}` });
  }
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await provisionSupabaseStudent(req, res);
}
