import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import {
  DEMO_USER_IDS,
  addActivityLog,
  addNotification,
  enrichDoctor,
  enrichPatient,
  hashPassword,
  loadDb,
  saveDb,
  verifyPassword,
  type StoredUser,
} from './server/db.ts';
import type {
  AppointmentStatus,
  AuthUser,
  LabStatus,
  PrescriptionStatus,
  UserRole,
} from './src/types/hospital.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PLACEHOLDER_SECRETS = new Set([
  'change-this-to-a-long-random-string-in-production',
  'fudma-healthcenter-dev-secret-key-2026',
  'secret',
  'dev-secret',
]);

function resolveSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (IS_PRODUCTION) {
    if (!configured || PLACEHOLDER_SECRETS.has(configured) || configured.length < 32) {
      console.error(
        '[SECURITY FATAL] SESSION_SECRET must be configured with at least 32 random characters in production.'
      );
      process.exit(1);
    }
    return configured;
  }
  if (configured && !PLACEHOLDER_SECRETS.has(configured) && configured.length >= 16) {
    return configured;
  }
  console.warn(
    '[SECURITY WARNING] SESSION_SECRET is not set; using an ephemeral random secret for this development process.'
  );
  return crypto.randomBytes(32).toString('hex');
}

const SESSION_SECRET = resolveSessionSecret();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

interface TokenPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

function signToken(user: StoredUser): string {
  const now = Date.now();
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as TokenPayload;
    if (!payload.sub || !payload.role || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie('fudma_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie('fudma_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
  });
}

function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('fudma_token=')) {
        return decodeURIComponent(c.slice('fudma_token='.length));
      }
    }
  }
  return null;
}

interface AuthedRequest extends Request {
  currentUser?: StoredUser;
}

function isDisallowedDemoUserInProd(user: StoredUser): boolean {
  if (!IS_PRODUCTION) return false;
  if (DEMO_USER_IDS.has(user.id)) {
    if (user.role === 'admin') return true;
    if (verifyPassword('Fudma@2026', user.password_hash)) return true;
  }
  return false;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  const db = loadDb();
  const user = db.users.find((u) => u.id === payload.sub);
  if (!user || !user.is_active) {
    res.status(403).json({ error: 'Account is inactive or unavailable.' });
    return;
  }
  if (user.role !== payload.role) {
    res.status(401).json({ error: 'Session role changed. Please sign in again.' });
    return;
  }
  if (isDisallowedDemoUserInProd(user)) {
    res.status(403).json({ error: 'Demonstration accounts are disabled in production.' });
    return;
  }
  req.currentUser = user;
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.currentUser.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

function buildAuthUser(user: StoredUser): AuthUser {
  const db = loadDb();
  const pat = db.patients.find((p) => p.profile_id === user.id);
  const doc = db.doctors.find((d) => d.profile_id === user.id);
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    date_of_birth: user.date_of_birth,
    address: user.address,
    role: user.role,
    is_active: user.is_active,
    patient: pat ? enrichPatient(db, pat) : null,
    doctor: doc ? enrichDoctor(db, doc) : null,
  };
}

function nextCode(prefix: string, existingCodes: string[]): string {
  const year = new Date().getFullYear();
  let maxNum = 1000;
  for (const code of existingCodes) {
    const parts = code.split('-');
    const tail = Number(parts[parts.length - 1]);
    if (!Number.isNaN(tail) && tail >= maxNum) {
      maxNum = tail;
    }
  }
  return `${prefix}-${year}-${maxNum + 1}`;
}

function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
  message: string;
}) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const cutoff = now - opts.windowMs;
    if (hits.size > 5000) {
      for (const [k, timestamps] of hits.entries()) {
        const recent = timestamps.filter((t) => t > cutoff);
        if (recent.length === 0) hits.delete(k);
        else hits.set(k, recent);
      }
    }
    const key = opts.keyFn(req);
    const recent = (hits.get(key) || []).filter((t) => t > cutoff);
    if (recent.length >= opts.max) {
      const retrySec = Math.max(1, Math.ceil((recent[0] + opts.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.status(429).json({ error: opts.message });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLINIC_TIME_SLOTS = new Set([
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30',
]);
const ALLOWED_GENDERS = new Set(['Male', 'Female', 'Other']);
const ALLOWED_CATEGORIES = new Set(['Student', 'Staff', 'Dependent', 'Community']);
const ALLOWED_BLOOD_GROUPS = new Set(['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const ALLOWED_GENOTYPES = new Set(['Unknown', 'AA', 'AS', 'SS', 'AC', 'SC']);
const ALLOWED_PRIORITIES = new Set(['Normal', 'Urgent', 'Emergency']);
const ALLOWED_URGENCIES = new Set(['Routine', 'Urgent', 'Stat']);
const ALLOWED_INTERPRETATIONS = new Set(['Normal', 'Abnormal', 'Critical']);

const ALLOWED_APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  Booked: ['Approved', 'Checked In', 'Waiting', 'Cancelled', 'Rescheduled'],
  Approved: ['Checked In', 'Waiting', 'Cancelled', 'Rescheduled'],
  Rescheduled: ['Approved', 'Checked In', 'Waiting', 'Cancelled', 'Rescheduled'],
  'Checked In': ['Waiting', 'In Consultation', 'Cancelled'],
  Waiting: ['In Consultation', 'Checked In', 'Cancelled'],
  'In Consultation': ['Completed', 'Waiting'],
  Completed: [],
  Cancelled: [],
};

const ALLOWED_LAB_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  Pending: ['Sample Collected', 'Processing', 'Completed'],
  'Sample Collected': ['Processing', 'Completed'],
  Processing: ['Completed'],
  Completed: ['Completed', 'Reviewed'],
  Reviewed: [],
};

const ALLOWED_PRESCRIPTION_TRANSITIONS: Record<PrescriptionStatus, PrescriptionStatus[]> = {
  Pending: ['Available', 'Partially Dispensed', 'Dispensed', 'Unavailable'],
  Available: ['Partially Dispensed', 'Dispensed', 'Unavailable'],
  'Partially Dispensed': ['Available', 'Partially Dispensed', 'Dispensed', 'Unavailable'],
  Unavailable: ['Available', 'Partially Dispensed', 'Dispensed'],
  Dispensed: [],
};

function isValidCalendarDate(dateStr: string): boolean {
  if (!VALID_DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Baseline security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-XSS-Protection', '0');
    if (IS_PRODUCTION) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
      );
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyFn: (req) => `${getClientIp(req)}:${String(req.body?.email || '').trim().toLowerCase()}`,
    message: 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.',
  });

  const loginIpLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyFn: (req) => `ip:${getClientIp(req)}`,
    message: 'Too many sign-in attempts from this network address. Please try again later.',
  });

  const resetLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyFn: (req) => `reset:${getClientIp(req)}`,
    message: 'Too many password recovery requests. Please try again later.',
  });

  const registerLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyFn: (req) => `reg:${getClientIp(req)}`,
    message: 'Too many registration attempts from this address. Please try again later.',
  });

  // =========================================================================
  // AUTHENTICATION ENDPOINTS
  // =========================================================================

  app.post('/api/auth/register', registerLimiter, (req: Request, res: Response) => {
    const {
      full_name,
      email,
      password,
      phone,
      gender,
      date_of_birth,
      address,
      matric_or_staff_id,
      patient_category,
      faculty_or_unit,
      blood_group,
      genotype,
      allergies,
      emergency_contact_name,
      emergency_contact_phone,
      role: requestedRole,
    } = req.body ?? {};

    if (requestedRole !== undefined && requestedRole !== 'patient') {
      res.status(403).json({ error: 'Public registration may only create patient accounts.' });
      return;
    }

    if (!full_name || !email || !password) {
      res.status(400).json({ error: 'Full name, email, and password are required.' });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!VALID_EMAIL_REGEX.test(normalizedEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    const passStr = String(password);
    if (passStr.length < 6 || passStr.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }
    if (['123456', 'password', 'qwerty'].includes(passStr.toLowerCase())) {
      res.status(400).json({ error: 'Please choose a stronger password.' });
      return;
    }
    if (gender && !ALLOWED_GENDERS.has(String(gender))) {
      res.status(400).json({ error: 'Invalid gender selection.' });
      return;
    }
    if (patient_category && !ALLOWED_CATEGORIES.has(String(patient_category))) {
      res.status(400).json({ error: 'Invalid patient category selection.' });
      return;
    }
    if (blood_group && !ALLOWED_BLOOD_GROUPS.has(String(blood_group))) {
      res.status(400).json({ error: 'Invalid blood group selection.' });
      return;
    }
    if (genotype && !ALLOWED_GENOTYPES.has(String(genotype))) {
      res.status(400).json({ error: 'Invalid genotype selection.' });
      return;
    }

    const db = loadDb();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    // SECURITY INVARIANT: Public registration strictly assigns 'patient' role only.
    const newUser: StoredUser = {
      id: userId,
      full_name: String(full_name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : null,
      gender: gender || null,
      date_of_birth: date_of_birth && isValidCalendarDate(String(date_of_birth)) ? String(date_of_birth) : null,
      address: address ? String(address).trim() : null,
      is_active: true,
      role: 'patient',
      password_hash: hashPassword(passStr),
      created_at: now,
      updated_at: now,
    };

    const hospNum = `FUDMA-HC-26-${String(db.patients.length + 101).padStart(4, '0')}`;
    const newPatient = {
      id: crypto.randomUUID(),
      profile_id: userId,
      hospital_number: hospNum,
      matric_or_staff_id: matric_or_staff_id ? String(matric_or_staff_id).trim() : null,
      patient_category: (patient_category || 'Student') as 'Student' | 'Staff' | 'Dependent' | 'Community',
      faculty_or_unit: faculty_or_unit ? String(faculty_or_unit).trim() : null,
      blood_group: blood_group || 'Unknown',
      genotype: genotype || 'Unknown',
      allergies: allergies ? String(allergies).trim() : 'None reported',
      emergency_contact_name: emergency_contact_name ? String(emergency_contact_name).trim() : null,
      emergency_contact_phone: emergency_contact_phone ? String(emergency_contact_phone).trim() : null,
      is_walk_in: false,
      full_name: newUser.full_name,
      email: newUser.email,
      phone: newUser.phone,
      gender: newUser.gender,
      date_of_birth: newUser.date_of_birth,
      address: newUser.address,
      created_at: now,
      updated_at: now,
    };

    db.users.push(newUser);
    db.patients.push(newPatient);
    addNotification(db, {
      recipient_user_id: userId,
      title: 'Welcome to FUDMA HEALTHCENTER',
      message: `Your patient file (${hospNum}) has been created. You can now book appointments online.`,
      category: 'account',
    });
    addActivityLog(db, {
      actor_id: userId,
      actor_name: newUser.full_name,
      actor_role: 'patient',
      action: 'PATIENT_REGISTERED',
      entity_type: 'patient',
      entity_id: hospNum,
      details: 'Public patient account registration completed.',
    });
    saveDb(db);

    const token = signToken(newUser);
    setSessionCookie(res, token);
    res.status(201).json({ token, user: buildAuthUser(newUser) });
  });

  app.post('/api/auth/login', loginIpLimiter, loginLimiter, (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const db = loadDb();
    const user = db.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    if (!user.is_active) {
      res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
      return;
    }
    if (isDisallowedDemoUserInProd(user)) {
      res.status(403).json({ error: 'Demonstration accounts are disabled in production.' });
      return;
    }

    const token = signToken(user);
    setSessionCookie(res, token);
    res.json({ token, user: buildAuthUser(user) });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.post('/api/auth/reset-password', resetLimiter, (_req: Request, res: Response) => {
    res.status(403).json({
      error:
        'Unauthenticated password reset is disabled for security. Use Supabase Auth email recovery or contact the System Administrator.',
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: buildAuthUser(req.currentUser!) });
  });

  // =========================================================================
  // REFERENCE DATA: DEPARTMENTS, DOCTORS, PUBLIC SETTINGS
  // =========================================================================

  app.get('/api/departments', (_req: Request, res: Response) => {
    const db = loadDb();
    res.json({ departments: db.departments });
  });

  app.get('/api/doctors', requireAuth, (_req: AuthedRequest, res: Response) => {
    const db = loadDb();
    res.json({ doctors: db.doctors.map((d) => enrichDoctor(db, d)) });
  });

  app.get('/api/settings/public', (_req: Request, res: Response) => {
    const db = loadDb();
    res.json({ settings: db.system_settings });
  });

  // =========================================================================
  // PATIENTS (PROFILE, SEARCH, WALK-IN REGISTRATION)
  // =========================================================================

  app.get('/api/patients', requireAuth, requireRole('patient', 'nurse', 'doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    if (user.role === 'patient') {
      const own = db.patients.filter((p) => p.profile_id === user.id).map((p) => enrichPatient(db, p));
      res.json({ patients: own });
      return;
    }
    const q = String(req.query.q || '').trim().toLowerCase();
    let list = db.patients.map((p) => enrichPatient(db, p));
    if (q) {
      list = list.filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) ||
          p.hospital_number.toLowerCase().includes(q) ||
          (p.matric_or_staff_id || '').toLowerCase().includes(q) ||
          (p.phone || '').toLowerCase().includes(q)
      );
    }
    res.json({ patients: list });
  });

  app.post('/api/patients/walk-in', requireAuth, requireRole('nurse', 'admin'), (req: AuthedRequest, res: Response) => {
    const {
      full_name,
      phone,
      email,
      gender,
      date_of_birth,
      address,
      matric_or_staff_id,
      patient_category,
      faculty_or_unit,
      blood_group,
      genotype,
      allergies,
      emergency_contact_name,
      emergency_contact_phone,
    } = req.body ?? {};

    if (!full_name || !phone) {
      res.status(400).json({ error: 'Patient full name and phone number are required.' });
      return;
    }
    const db = loadDb();
    const now = new Date().toISOString();
    const hospNum = `FUDMA-HC-26-${String(db.patients.length + 101).padStart(4, '0')}`;

    const newPat = {
      id: crypto.randomUUID(),
      profile_id: null,
      hospital_number: hospNum,
      matric_or_staff_id: matric_or_staff_id ? String(matric_or_staff_id).trim() : null,
      patient_category: (patient_category || 'Student') as 'Student' | 'Staff' | 'Dependent' | 'Community',
      faculty_or_unit: faculty_or_unit ? String(faculty_or_unit).trim() : null,
      blood_group: blood_group || 'Unknown',
      genotype: genotype || 'Unknown',
      allergies: allergies ? String(allergies).trim() : 'None reported',
      emergency_contact_name: emergency_contact_name ? String(emergency_contact_name).trim() : null,
      emergency_contact_phone: emergency_contact_phone ? String(emergency_contact_phone).trim() : null,
      is_walk_in: true,
      full_name: String(full_name).trim(),
      email: email ? String(email).trim().toLowerCase() : null,
      phone: String(phone).trim(),
      gender: gender || null,
      date_of_birth: date_of_birth || null,
      address: address ? String(address).trim() : null,
      created_at: now,
      updated_at: now,
    };

    db.patients.unshift(newPat);
    addActivityLog(db, {
      actor_id: req.currentUser!.id,
      actor_name: req.currentUser!.full_name,
      actor_role: req.currentUser!.role,
      action: 'WALK_IN_REGISTERED',
      entity_type: 'patient',
      entity_id: hospNum,
      details: `Registered walk-in patient ${newPat.full_name}.`,
    });
    saveDb(db);
    res.status(201).json({ patient: enrichPatient(db, newPat) });
  });

  app.patch('/api/patients/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const pat = db.patients.find((p) => p.id === req.params.id);
    if (!pat) {
      res.status(404).json({ error: 'Patient record not found.' });
      return;
    }
    const user = req.currentUser!;
    if (user.role === 'patient' && pat.profile_id !== user.id) {
      res.status(403).json({ error: 'Patients can only update their own personal record.' });
      return;
    }
    if (!['patient', 'nurse', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'Insufficient permissions to edit patient demographics.' });
      return;
    }

    const body = req.body ?? {};
    const {
      full_name,
      phone,
      gender,
      date_of_birth,
      address,
      matric_or_staff_id,
      patient_category,
      faculty_or_unit,
      blood_group,
      genotype,
      allergies,
      emergency_contact_name,
      emergency_contact_phone,
    } = body;

    if (user.role === 'patient') {
      const restrictedFields = [
        'hospital_number',
        'matric_or_staff_id',
        'patient_category',
        'faculty_or_unit',
        'is_walk_in',
        'profile_id',
      ];
      for (const field of restrictedFields) {
        if (body[field] !== undefined) {
          res.status(403).json({
            error: `Patients cannot modify restricted institutional identity field (${field}).`,
          });
          return;
        }
      }
    }

    if (gender !== undefined && gender !== null && gender !== '' && !ALLOWED_GENDERS.has(String(gender))) {
      res.status(400).json({ error: 'Invalid gender value.' });
      return;
    }
    if (patient_category !== undefined && !ALLOWED_CATEGORIES.has(String(patient_category))) {
      res.status(400).json({ error: 'Invalid patient category value.' });
      return;
    }
    if (blood_group !== undefined && !ALLOWED_BLOOD_GROUPS.has(String(blood_group))) {
      res.status(400).json({ error: 'Invalid blood group value.' });
      return;
    }
    if (genotype !== undefined && !ALLOWED_GENOTYPES.has(String(genotype))) {
      res.status(400).json({ error: 'Invalid genotype value.' });
      return;
    }
    if (date_of_birth !== undefined && date_of_birth !== null && date_of_birth !== '' && !isValidCalendarDate(String(date_of_birth))) {
      res.status(400).json({ error: 'Invalid date of birth format (YYYY-MM-DD).' });
      return;
    }

    const now = new Date().toISOString();
    if (full_name) pat.full_name = String(full_name).trim();
    if (phone !== undefined) pat.phone = phone ? String(phone).trim() : null;
    if (gender !== undefined) pat.gender = gender || null;
    if (date_of_birth !== undefined) pat.date_of_birth = date_of_birth || null;
    if (address !== undefined) pat.address = address ? String(address).trim() : null;
    if (user.role !== 'patient') {
      if (matric_or_staff_id !== undefined) pat.matric_or_staff_id = matric_or_staff_id ? String(matric_or_staff_id).trim() : null;
      if (patient_category) pat.patient_category = patient_category;
      if (faculty_or_unit !== undefined) pat.faculty_or_unit = faculty_or_unit ? String(faculty_or_unit).trim() : null;
    }
    if (blood_group) pat.blood_group = blood_group;
    if (genotype) pat.genotype = genotype;
    if (allergies !== undefined) pat.allergies = allergies ? String(allergies).trim() : null;
    if (emergency_contact_name !== undefined) pat.emergency_contact_name = emergency_contact_name ? String(emergency_contact_name).trim() : null;
    if (emergency_contact_phone !== undefined) pat.emergency_contact_phone = emergency_contact_phone ? String(emergency_contact_phone).trim() : null;
    pat.updated_at = now;

    if (pat.profile_id) {
      const prof = db.users.find((u) => u.id === pat.profile_id);
      if (prof) {
        if (full_name) prof.full_name = pat.full_name;
        if (phone !== undefined) prof.phone = pat.phone;
        if (gender !== undefined) prof.gender = pat.gender;
        if (date_of_birth !== undefined) prof.date_of_birth = pat.date_of_birth;
        if (address !== undefined) prof.address = pat.address;
        prof.updated_at = now;
      }
    }

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'PATIENT_UPDATED',
      entity_type: 'patient',
      entity_id: pat.hospital_number,
      details: `Updated demographics for ${pat.full_name}.`,
    });
    saveDb(db);
    res.json({ patient: enrichPatient(db, pat) });
  });

  // =========================================================================
  // APPOINTMENTS & NURSING CHECK-IN / QUEUE ALLOCATION
  // =========================================================================

  app.get('/api/appointments', requireAuth, requireRole('patient', 'nurse', 'doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    let list = db.appointments;

    if (user.role === 'patient') {
      const pat = db.patients.find((p) => p.profile_id === user.id);
      list = pat ? list.filter((a) => a.patient_id === pat.id) : [];
    } else if (user.role === 'doctor') {
      const doc = db.doctors.find((d) => d.profile_id === user.id);
      list = doc
        ? list.filter(
            (a) => a.doctor_id === doc.id || (!a.doctor_id && (a.status === 'Waiting' || a.status === 'Checked In'))
          )
        : [];
    }

    const enriched = list
      .map((a) => {
        const pat = db.patients.find((p) => p.id === a.patient_id);
        const dept = db.departments.find((d) => d.id === a.department_id);
        const doc = a.doctor_id ? db.doctors.find((d) => d.id === a.doctor_id) : null;
        const docUser = doc ? db.users.find((u) => u.id === doc.profile_id) : null;
        return {
          ...a,
          patient_name: pat ? enrichPatient(db, pat).full_name : 'Unknown Patient',
          patient_hospital_number: pat?.hospital_number || '',
          patient_category: pat?.patient_category || 'Student',
          department_name: dept?.name || 'General Outpatient',
          doctor_name: docUser?.full_name || null,
        };
      })
      .sort((a, b) => (b.appointment_date + b.appointment_time).localeCompare(a.appointment_date + a.appointment_time));

    res.json({ appointments: enriched });
  });

  app.post('/api/appointments', requireAuth, requireRole('patient', 'nurse', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const {
      patient_id,
      department_id,
      doctor_id,
      consultation_category,
      appointment_date,
      appointment_time,
      reason,
      auto_check_in,
    } = req.body ?? {};

    let targetPatientId = patient_id;
    if (user.role === 'patient') {
      const ownPat = db.patients.find((p) => p.profile_id === user.id);
      if (!ownPat) {
        res.status(404).json({ error: 'Patient profile not found.' });
        return;
      }
      if (patient_id && patient_id !== ownPat.id) {
        res.status(403).json({ error: 'Patients can only book appointments for their own file.' });
        return;
      }
      targetPatientId = ownPat.id;
    }

    const pat = db.patients.find((p) => p.id === targetPatientId);
    if (!pat) {
      res.status(404).json({ error: 'Selected patient not found.' });
      return;
    }
    if (!department_id || !consultation_category || !appointment_date || !appointment_time || !reason) {
      res.status(400).json({ error: 'Department, category, date, time, and reason are required.' });
      return;
    }

    const dept = db.departments.find((d) => d.id === department_id);
    if (!dept || !dept.is_active) {
      res.status(400).json({ error: 'Selected clinical department is invalid or inactive.' });
      return;
    }
    if (doctor_id) {
      const doc = db.doctors.find((d) => d.id === doctor_id);
      if (!doc || !doc.is_available) {
        res.status(400).json({ error: 'Selected doctor is invalid or unavailable.' });
        return;
      }
    }

    const dateStr = String(appointment_date).trim();
    const timeStr = String(appointment_time).trim();
    if (!isValidCalendarDate(dateStr)) {
      res.status(400).json({ error: 'Invalid appointment date format (YYYY-MM-DD).' });
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateStr < todayStr) {
      res.status(400).json({ error: 'Appointment date cannot be in the past.' });
      return;
    }
    if (!VALID_TIME_REGEX.test(timeStr)) {
      res.status(400).json({ error: 'Invalid appointment time format (HH:MM).' });
      return;
    }
    if (user.role === 'patient' && !CLINIC_TIME_SLOTS.has(timeStr)) {
      res.status(400).json({ error: 'Please select a valid clinic consultation time slot (08:00 - 17:30).' });
      return;
    }

    const sameDayCount = db.appointments.filter(
      (a) => a.appointment_date === dateStr && a.status !== 'Cancelled'
    ).length;
    if (sameDayCount >= db.system_settings.max_daily_appointments) {
      res.status(409).json({ error: 'Selected date has reached maximum daily clinic capacity.' });
      return;
    }

    const conflict = db.appointments.find(
      (a) =>
        a.patient_id === pat.id &&
        a.appointment_date === dateStr &&
        a.appointment_time === timeStr &&
        a.status !== 'Cancelled'
    );
    if (conflict) {
      res.status(409).json({ error: 'You already have an active appointment at this date and time.' });
      return;
    }

    const now = new Date().toISOString();
    const code = nextCode('APT', db.appointments.map((a) => a.appointment_code));
    const isWalkInCheckIn = Boolean(auto_check_in && (user.role === 'nurse' || user.role === 'admin'));
    const dayQueueMax = db.appointments
      .filter((a) => a.appointment_date === dateStr && a.queue_number)
      .reduce((acc, item) => Math.max(acc, item.queue_number || 0), 0);

    const appt = {
      id: crypto.randomUUID(),
      appointment_code: code,
      patient_id: pat.id,
      department_id: dept.id,
      doctor_id: doctor_id || null,
      consultation_category: String(consultation_category).trim(),
      appointment_date: dateStr,
      appointment_time: timeStr,
      reason: String(reason).trim(),
      status: isWalkInCheckIn ? ('Checked In' as const) : ('Booked' as const),
      queue_number: isWalkInCheckIn ? dayQueueMax + 1 : null,
      checked_in_at: isWalkInCheckIn ? now : null,
      checked_in_by: isWalkInCheckIn ? user.id : null,
      notes: null,
      created_at: now,
      updated_at: now,
    };

    db.appointments.unshift(appt);

    if (pat.profile_id) {
      addNotification(db, {
        recipient_user_id: pat.profile_id,
        title: 'Appointment Booked',
        message: `Appointment ${code} booked for ${appt.appointment_date} at ${appt.appointment_time} (${appt.consultation_category}).`,
        category: 'appointment',
        reference_id: appt.id,
      });
    }
    addNotification(db, {
      recipient_role: 'nurse',
      title: 'New Appointment Scheduled',
      message: `${pat.full_name} (${pat.hospital_number}) booked ${code} for ${appt.appointment_date} at ${appt.appointment_time}.`,
      category: 'appointment',
      reference_id: appt.id,
    });
    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'APPOINTMENT_BOOKED',
      entity_type: 'appointment',
      entity_id: code,
      details: `Booked ${appt.consultation_category} on ${appt.appointment_date} at ${appt.appointment_time}.`,
    });
    saveDb(db);
    res.status(201).json({ appointment: appt });
  });

  app.patch('/api/appointments/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const appt = db.appointments.find((a) => a.id === req.params.id);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }

    const pat = db.patients.find((p) => p.id === appt.patient_id);
    const { status, doctor_id, appointment_date, appointment_time, notes } = req.body ?? {};

    if (user.role === 'patient') {
      if (!pat || pat.profile_id !== user.id) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }
      if (doctor_id !== undefined || appointment_date !== undefined || appointment_time !== undefined || notes !== undefined) {
        res.status(403).json({ error: 'Patients may not modify scheduling slots, doctor allocation, or clinical notes.' });
        return;
      }
      if (status !== 'Cancelled') {
        res.status(403).json({ error: 'Patients may only cancel eligible appointments.' });
        return;
      }
      if (!db.system_settings.allow_patient_cancellations) {
        res.status(403).json({ error: 'Self-cancellation is currently disabled by hospital policy.' });
        return;
      }
      if (!['Booked', 'Approved', 'Rescheduled'].includes(appt.status)) {
        res.status(400).json({ error: 'Checked-in or completed appointments cannot be cancelled.' });
        return;
      }
    } else if (!['nurse', 'doctor', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'You do not have permission to update appointments.' });
      return;
    }

    if (status !== undefined) {
      const nextStatus = String(status) as AppointmentStatus;
      if (!(nextStatus in ALLOWED_APPOINTMENT_TRANSITIONS)) {
        res.status(400).json({ error: 'Invalid appointment status value.' });
        return;
      }
      if (nextStatus !== appt.status && !ALLOWED_APPOINTMENT_TRANSITIONS[appt.status].includes(nextStatus)) {
        res.status(400).json({
          error: `Invalid appointment status transition from ${appt.status} to ${nextStatus}.`,
        });
        return;
      }
      if (user.role === 'doctor') {
        const doc = db.doctors.find((d) => d.profile_id === user.id);
        if (!doc || (appt.doctor_id && appt.doctor_id !== doc.id)) {
          res.status(403).json({ error: 'Doctors can only update appointments assigned to them.' });
          return;
        }
      }
    }

    if (doctor_id !== undefined && doctor_id !== null && doctor_id !== '') {
      if (!['nurse', 'admin'].includes(user.role)) {
        res.status(403).json({ error: 'Only nursing staff or administrators can assign consultant doctors.' });
        return;
      }
      const doc = db.doctors.find((d) => d.id === doctor_id);
      if (!doc) {
        res.status(404).json({ error: 'Assigned consultant doctor not found.' });
        return;
      }
    }

    if (appointment_date !== undefined) {
      const dateStr = String(appointment_date).trim();
      if (!isValidCalendarDate(dateStr)) {
        res.status(400).json({ error: 'Invalid appointment date format (YYYY-MM-DD).' });
        return;
      }
      if (dateStr < new Date().toISOString().slice(0, 10)) {
        res.status(400).json({ error: 'Rescheduled appointment date cannot be in the past.' });
        return;
      }
    }
    if (appointment_time !== undefined && !VALID_TIME_REGEX.test(String(appointment_time).trim())) {
      res.status(400).json({ error: 'Invalid appointment time format (HH:MM).' });
      return;
    }

    const now = new Date().toISOString();
    const prevStatus = appt.status;
    if (status) appt.status = status;
    if (doctor_id !== undefined) appt.doctor_id = doctor_id || null;
    if (appointment_date) appt.appointment_date = String(appointment_date).trim();
    if (appointment_time) appt.appointment_time = String(appointment_time).trim();
    if (notes !== undefined) appt.notes = notes ? String(notes).trim() : null;

    if ((status === 'Checked In' || status === 'Waiting') && !appt.queue_number) {
      const dayMax = db.appointments
        .filter((a) => a.appointment_date === appt.appointment_date && a.queue_number)
        .reduce((acc, item) => Math.max(acc, item.queue_number || 0), 0);
      appt.queue_number = dayMax + 1;
      appt.checked_in_at = now;
      appt.checked_in_by = user.id;
    }
    appt.updated_at = now;

    if (pat?.profile_id && status && status !== prevStatus) {
      const msgMap: Record<string, string> = {
        Approved: `Your appointment ${appt.appointment_code} has been approved.`,
        'Checked In': `You have been checked in for ${appt.appointment_code} (Queue #${appt.queue_number ?? '-'}).`,
        Waiting: `You are now in the consultation waiting queue (#${appt.queue_number ?? '-'}).`,
        'In Consultation': `Your doctor is ready to see you for ${appt.appointment_code}.`,
        Completed: `Your consultation for ${appt.appointment_code} has been marked completed.`,
        Cancelled: `Appointment ${appt.appointment_code} has been cancelled.`,
        Rescheduled: `Appointment ${appt.appointment_code} has been rescheduled to ${appt.appointment_date} at ${appt.appointment_time}.`,
      };
      addNotification(db, {
        recipient_user_id: pat.profile_id,
        title: `Appointment ${status}`,
        message: msgMap[status] || `Appointment ${appt.appointment_code} status changed to ${status}.`,
        category: 'appointment',
        reference_id: appt.id,
      });
    }

    if (status === 'Waiting' && appt.doctor_id) {
      const doc = db.doctors.find((d) => d.id === appt.doctor_id);
      if (doc) {
        addNotification(db, {
          recipient_user_id: doc.profile_id,
          title: 'Patient Ready in Waiting Queue',
          message: `${pat?.full_name || 'Patient'} (${appt.appointment_code}, Queue #${appt.queue_number}) has completed nursing triage.`,
          category: 'queue',
          reference_id: appt.id,
        });
      }
    }

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'APPOINTMENT_UPDATED',
      entity_type: 'appointment',
      entity_id: appt.appointment_code,
      details: `Updated status: ${prevStatus} -> ${appt.status}${doctor_id ? ' (Doctor assigned)' : ''}.`,
    });
    saveDb(db);
    res.json({ appointment: appt });
  });

  // =========================================================================
  // PATIENT VITALS (NURSING & DOCTOR)
  // =========================================================================

  app.get('/api/vitals', requireAuth, requireRole('patient', 'nurse', 'doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    let list = db.vitals;
    if (user.role === 'patient') {
      const pat = db.patients.find((p) => p.profile_id === user.id);
      list = pat ? list.filter((v) => v.patient_id === pat.id) : [];
    } else if (req.query.patient_id) {
      list = list.filter((v) => v.patient_id === req.query.patient_id);
    }

    const enriched = list.map((v) => {
      const pat = db.patients.find((p) => p.id === v.patient_id);
      const rec = db.users.find((u) => u.id === v.recorded_by);
      return {
        ...v,
        patient_name: pat?.full_name || 'Unknown',
        recorded_by_name: rec?.full_name || 'Nursing Staff',
      };
    });
    res.json({ vitals: enriched });
  });

  app.post('/api/vitals', requireAuth, requireRole('nurse', 'doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const {
      appointment_id,
      temperature_c,
      blood_pressure,
      pulse_bpm,
      respiratory_rate,
      spo2_percent,
      weight_kg,
      height_cm,
      triage_notes,
      priority,
      doctor_id,
    } = req.body ?? {};

    const appt = db.appointments.find((a) => a.id === appointment_id);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    if (appt.status === 'Cancelled' || appt.status === 'Completed') {
      res.status(400).json({ error: `Cannot record triage vitals for a ${appt.status} appointment.` });
      return;
    }
    if (priority && !ALLOWED_PRIORITIES.has(String(priority))) {
      res.status(400).json({ error: 'Invalid triage priority level.' });
      return;
    }
    if (doctor_id) {
      const doc = db.doctors.find((d) => d.id === doctor_id);
      if (!doc) {
        res.status(404).json({ error: 'Allocated consultant doctor not found.' });
        return;
      }
    }

    const parseOptNum = (val: unknown, min: number, max: number, label: string): number | null | 'INVALID' => {
      if (val === undefined || val === null || val === '') return null;
      const n = Number(val);
      if (!Number.isFinite(n) || n < min || n > max) return 'INVALID';
      return n;
    };

    const tempVal = parseOptNum(temperature_c, 30, 45, 'Temperature');
    const pulseVal = parseOptNum(pulse_bpm, 20, 250, 'Pulse');
    const respVal = parseOptNum(respiratory_rate, 5, 80, 'Respiratory rate');
    const spo2Val = parseOptNum(spo2_percent, 40, 100, 'SpO2');
    const weightVal = parseOptNum(weight_kg, 1, 350, 'Weight');
    const heightVal = parseOptNum(height_cm, 30, 250, 'Height');
    if (
      tempVal === 'INVALID' ||
      pulseVal === 'INVALID' ||
      respVal === 'INVALID' ||
      spo2Val === 'INVALID' ||
      weightVal === 'INVALID' ||
      heightVal === 'INVALID'
    ) {
      res.status(400).json({ error: 'One or more vital sign measurements are outside valid clinical ranges.' });
      return;
    }

    const now = new Date().toISOString();
    const vital = {
      id: crypto.randomUUID(),
      appointment_id: appt.id,
      patient_id: appt.patient_id,
      recorded_by: user.id,
      temperature_c: tempVal,
      blood_pressure: blood_pressure ? String(blood_pressure).trim() : null,
      pulse_bpm: pulseVal,
      respiratory_rate: respVal,
      spo2_percent: spo2Val,
      weight_kg: weightVal,
      height_cm: heightVal,
      triage_notes: triage_notes ? String(triage_notes).trim() : null,
      priority: (priority || 'Normal') as 'Normal' | 'Urgent' | 'Emergency',
      created_at: now,
      updated_at: now,
    };

    db.vitals.unshift(vital);

    // Move appointment into Waiting queue if Checked In or Booked
    if (['Booked', 'Approved', 'Checked In'].includes(appt.status)) {
      appt.status = 'Waiting';
      if (!appt.queue_number) {
        const dayMax = db.appointments
          .filter((a) => a.appointment_date === appt.appointment_date && a.queue_number)
          .reduce((acc, item) => Math.max(acc, item.queue_number || 0), 0);
        appt.queue_number = dayMax + 1;
        appt.checked_in_at = appt.checked_in_at || now;
        appt.checked_in_by = appt.checked_in_by || user.id;
      }
    }
    if (doctor_id) {
      appt.doctor_id = doctor_id;
    }
    appt.updated_at = now;

    const pat = db.patients.find((p) => p.id === appt.patient_id);
    if (appt.doctor_id) {
      const doc = db.doctors.find((d) => d.id === appt.doctor_id);
      if (doc) {
        addNotification(db, {
          recipient_user_id: doc.profile_id,
          title: 'Patient Triage Completed',
          message: `${pat?.full_name || 'Patient'} (${appt.appointment_code}) vitals recorded (${vital.priority}) and queued.`,
          category: 'queue',
          reference_id: appt.id,
        });
      }
    }

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'VITALS_RECORDED',
      entity_type: 'patient_vitals',
      entity_id: appt.appointment_code,
      details: `Recorded vital signs (BP: ${vital.blood_pressure || 'N/A'}, Temp: ${vital.temperature_c ?? 'N/A'}°C, Priority: ${vital.priority}).`,
    });
    saveDb(db);
    res.status(201).json({ vital, appointment: appt });
  });

  // =========================================================================
  // CONSULTATIONS (DOCTOR & PATIENT HISTORY)
  // =========================================================================

  app.get('/api/consultations', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    let list = db.consultations;

    if (user.role === 'patient') {
      const pat = db.patients.find((p) => p.profile_id === user.id);
      list = pat ? list.filter((c) => c.patient_id === pat.id) : [];
    } else if (!['doctor', 'nurse', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const enriched = list.map((c) => {
      const pat = db.patients.find((p) => p.id === c.patient_id);
      const doc = db.doctors.find((d) => d.id === c.doctor_id);
      const docUser = doc ? db.users.find((u) => u.id === doc.profile_id) : null;
      const appt = db.appointments.find((a) => a.id === c.appointment_id);
      return {
        ...c,
        appointment_code: appt?.appointment_code || '',
        patient_name: pat?.full_name || 'Unknown',
        patient_hospital_number: pat?.hospital_number || '',
        doctor_name: docUser?.full_name || 'Medical Officer',
      };
    });
    res.json({ consultations: enriched });
  });

  app.post('/api/consultations', requireAuth, requireRole('doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const {
      appointment_id,
      chief_complaint,
      clinical_observations,
      diagnosis,
      treatment_plan,
      follow_up_date,
      follow_up_notes,
      status,
    } = req.body ?? {};

    const appt = db.appointments.find((a) => a.id === appointment_id);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    if (!['Checked In', 'Waiting', 'In Consultation', 'Completed'].includes(appt.status)) {
      res.status(400).json({ error: `Cannot consult on an appointment in "${appt.status}" status.` });
      return;
    }
    if (!chief_complaint || !clinical_observations || !diagnosis) {
      res.status(400).json({ error: 'Chief complaint, clinical observations, and diagnosis are required.' });
      return;
    }
    if (status && !['In Progress', 'Awaiting Lab', 'Completed'].includes(String(status))) {
      res.status(400).json({ error: 'Invalid consultation status.' });
      return;
    }
    if (follow_up_date && !isValidCalendarDate(String(follow_up_date))) {
      res.status(400).json({ error: 'Invalid follow-up date format (YYYY-MM-DD).' });
      return;
    }

    const docRecord =
      user.role === 'doctor'
        ? db.doctors.find((d) => d.profile_id === user.id)
        : db.doctors.find((d) => d.id === appt.doctor_id) || db.doctors.find((d) => d.profile_id === user.id);

    if (!docRecord) {
      res.status(403).json({ error: 'Consultant doctor profile is not linked.' });
      return;
    }
    if (user.role === 'doctor' && appt.doctor_id && appt.doctor_id !== docRecord.id) {
      res.status(403).json({ error: 'This appointment is assigned to another consultant doctor.' });
      return;
    }

    const now = new Date().toISOString();
    let consultation = db.consultations.find((c) => c.appointment_id === appt.id);
    if (consultation) {
      if (user.role === 'doctor' && consultation.doctor_id !== docRecord.id) {
        res.status(403).json({ error: 'Only the attending consultant doctor may update this consultation.' });
        return;
      }
      consultation.chief_complaint = String(chief_complaint).trim();
      consultation.clinical_observations = String(clinical_observations).trim();
      consultation.diagnosis = String(diagnosis).trim();
      consultation.treatment_plan = treatment_plan ? String(treatment_plan).trim() : null;
      consultation.follow_up_date = follow_up_date || null;
      consultation.follow_up_notes = follow_up_notes ? String(follow_up_notes).trim() : null;
      consultation.status = status || consultation.status;
      consultation.updated_at = now;
    } else {
      consultation = {
        id: crypto.randomUUID(),
        appointment_id: appt.id,
        patient_id: appt.patient_id,
        doctor_id: docRecord.id,
        chief_complaint: String(chief_complaint).trim(),
        clinical_observations: String(clinical_observations).trim(),
        diagnosis: String(diagnosis).trim(),
        treatment_plan: treatment_plan ? String(treatment_plan).trim() : null,
        follow_up_date: follow_up_date || null,
        follow_up_notes: follow_up_notes ? String(follow_up_notes).trim() : null,
        status: status || 'In Progress',
        created_at: now,
        updated_at: now,
      };
      db.consultations.unshift(consultation);
    }

    appt.doctor_id = docRecord.id;
    appt.status = consultation.status === 'Completed' ? 'Completed' : 'In Consultation';
    appt.updated_at = now;

    const pat = db.patients.find((p) => p.id === appt.patient_id);
    if (consultation.status === 'Completed' && pat?.profile_id) {
      addNotification(db, {
        recipient_user_id: pat.profile_id,
        title: 'Consultation Completed',
        message: `Your consultation for ${appt.appointment_code} is completed. Diagnosis and treatment plan are available in your records.`,
        category: 'consultation',
        reference_id: consultation.id,
      });
    }

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'CONSULTATION_SAVED',
      entity_type: 'consultation',
      entity_id: appt.appointment_code,
      details: `Saved consultation (${consultation.status}) — Diagnosis: ${consultation.diagnosis}.`,
    });
    saveDb(db);
    res.status(201).json({ consultation });
  });

  // =========================================================================
  // LABORATORY REQUESTS & RESULTS
  // =========================================================================

  app.get('/api/laboratory/requests', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    let list = db.laboratory_requests;

    if (user.role === 'patient') {
      const pat = db.patients.find((p) => p.profile_id === user.id);
      list = pat ? list.filter((r) => r.patient_id === pat.id) : [];
    } else if (!['lab', 'doctor', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const enriched = list.map((r) => {
      const pat = db.patients.find((p) => p.id === r.patient_id);
      const doc = db.doctors.find((d) => d.id === r.doctor_id);
      const docUser = doc ? db.users.find((u) => u.id === doc.profile_id) : null;
      const result = db.laboratory_results.find((resItem) => resItem.lab_request_id === r.id) || null;
      const recUser = result ? db.users.find((u) => u.id === result.recorded_by) : null;
      return {
        ...r,
        patient_name: pat?.full_name || 'Unknown',
        patient_hospital_number: pat?.hospital_number || '',
        doctor_name: docUser?.full_name || 'Medical Officer',
        result: result ? { ...result, recorded_by_name: recUser?.full_name || 'Lab Scientist' } : null,
      };
    });

    res.json({ requests: enriched });
  });

  app.post('/api/laboratory/requests', requireAuth, requireRole('doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const { consultation_id, test_name, test_category, clinical_notes, urgency } = req.body ?? {};

    const con = db.consultations.find((c) => c.id === consultation_id);
    if (!con) {
      res.status(404).json({ error: 'Consultation record not found.' });
      return;
    }
    if (user.role === 'doctor') {
      const docRecord = db.doctors.find((d) => d.profile_id === user.id);
      if (!docRecord || con.doctor_id !== docRecord.id) {
        res.status(403).json({ error: 'Only the attending consultant doctor may order labs for this consultation.' });
        return;
      }
    }
    if (!test_name || !test_category) {
      res.status(400).json({ error: 'Test name and category are required.' });
      return;
    }
    if (urgency && !ALLOWED_URGENCIES.has(String(urgency))) {
      res.status(400).json({ error: 'Invalid urgency level.' });
      return;
    }

    const now = new Date().toISOString();
    const code = nextCode('LAB', db.laboratory_requests.map((r) => r.request_code));
    const labReq = {
      id: crypto.randomUUID(),
      request_code: code,
      consultation_id: con.id,
      patient_id: con.patient_id,
      doctor_id: con.doctor_id,
      test_name: String(test_name).trim(),
      test_category: String(test_category).trim(),
      clinical_notes: clinical_notes ? String(clinical_notes).trim() : null,
      urgency: (urgency || 'Routine') as 'Routine' | 'Urgent' | 'Stat',
      status: 'Pending' as const,
      assigned_lab_staff: null,
      created_at: now,
      updated_at: now,
    };

    db.laboratory_requests.unshift(labReq);
    con.status = 'Awaiting Lab';
    con.updated_at = now;

    const pat = db.patients.find((p) => p.id === con.patient_id);
    addNotification(db, {
      recipient_role: 'lab',
      title: 'New Laboratory Investigation Request',
      message: `${labReq.test_name} (${labReq.urgency}) ordered for ${pat?.full_name || 'Patient'} (${code}).`,
      category: 'laboratory',
      reference_id: labReq.id,
    });
    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'LAB_REQUESTED',
      entity_type: 'laboratory_request',
      entity_id: code,
      details: `Ordered ${labReq.test_name} (${labReq.test_category}) for ${pat?.full_name || ''}.`,
    });
    saveDb(db);
    res.status(201).json({ request: labReq });
  });

  app.patch('/api/laboratory/requests/:id', requireAuth, requireRole('lab', 'doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const labReq = db.laboratory_requests.find((r) => r.id === req.params.id);
    if (!labReq) {
      res.status(404).json({ error: 'Laboratory request not found.' });
      return;
    }

    const { status, findings, numeric_value, reference_range, interpretation, scientist_remarks } = req.body ?? {};
    const now = new Date().toISOString();
    const pat = db.patients.find((p) => p.id === labReq.patient_id);
    const doc = db.doctors.find((d) => d.id === labReq.doctor_id);

    if (status !== undefined) {
      const nextStatus = String(status) as LabStatus;
      if (!(nextStatus in ALLOWED_LAB_TRANSITIONS)) {
        res.status(400).json({ error: 'Invalid laboratory request status.' });
        return;
      }
      if (nextStatus !== labReq.status && !ALLOWED_LAB_TRANSITIONS[labReq.status].includes(nextStatus)) {
        res.status(400).json({
          error: `Invalid laboratory status transition from ${labReq.status} to ${nextStatus}.`,
        });
        return;
      }
    }

    if (interpretation && !ALLOWED_INTERPRETATIONS.has(String(interpretation))) {
      res.status(400).json({ error: 'Invalid laboratory result interpretation.' });
      return;
    }

    if (user.role === 'doctor') {
      const docRecord = db.doctors.find((d) => d.profile_id === user.id);
      if (!docRecord || labReq.doctor_id !== docRecord.id) {
        res.status(403).json({ error: 'Only the ordering consultant doctor may review this lab result.' });
        return;
      }
      if (status !== 'Reviewed' || findings !== undefined) {
        res.status(403).json({ error: 'Doctors may only mark completed lab results as Reviewed.' });
        return;
      }
    }

    if (user.role === 'lab' && status === 'Reviewed') {
      res.status(403).json({ error: 'Only a consultant doctor or administrator may mark lab results as Reviewed.' });
      return;
    }

    if ((user.role === 'lab' || user.role === 'admin') && status !== 'Reviewed') {
      if (labReq.status === 'Reviewed') {
        res.status(400).json({ error: 'Reviewed laboratory reports are locked and cannot be modified.' });
        return;
      }
      if (status === 'Completed' && (!findings || !String(findings).trim())) {
        res.status(400).json({ error: 'Diagnostic findings are required to complete a laboratory request.' });
        return;
      }
      if (status) {
        labReq.status = status;
        labReq.assigned_lab_staff = user.id;
      }
      if (findings && String(findings).trim()) {
        let result = db.laboratory_results.find((r) => r.lab_request_id === labReq.id);
        if (result) {
          result.findings = String(findings).trim();
          result.numeric_value = numeric_value ? String(numeric_value).trim() : null;
          result.reference_range = reference_range ? String(reference_range).trim() : null;
          result.interpretation = (interpretation || 'Normal') as 'Normal' | 'Abnormal' | 'Critical';
          result.scientist_remarks = scientist_remarks ? String(scientist_remarks).trim() : null;
          result.updated_at = now;
        } else {
          result = {
            id: crypto.randomUUID(),
            lab_request_id: labReq.id,
            recorded_by: user.id,
            findings: String(findings).trim(),
            numeric_value: numeric_value ? String(numeric_value).trim() : null,
            reference_range: reference_range ? String(reference_range).trim() : null,
            interpretation: (interpretation || 'Normal') as 'Normal' | 'Abnormal' | 'Critical',
            scientist_remarks: scientist_remarks ? String(scientist_remarks).trim() : null,
            reviewed_by_doctor: false,
            reviewed_at: null,
            created_at: now,
            updated_at: now,
          };
          db.laboratory_results.unshift(result);
        }
        labReq.status = 'Completed';
        labReq.assigned_lab_staff = user.id;

        if (doc) {
          addNotification(db, {
            recipient_user_id: doc.profile_id,
            title: 'Laboratory Results Ready for Review',
            message: `${labReq.test_name} results (${labReq.request_code}) for ${pat?.full_name || 'Patient'} are completed.`,
            category: 'laboratory',
            reference_id: labReq.id,
          });
        }
        if (pat?.profile_id) {
          addNotification(db, {
            recipient_user_id: pat.profile_id,
            title: 'Laboratory Results Available',
            message: `Your ${labReq.test_name} (${labReq.request_code}) laboratory report has been completed.`,
            category: 'laboratory',
            reference_id: labReq.id,
          });
        }
      }
    }

    if ((user.role === 'doctor' || user.role === 'admin') && status === 'Reviewed') {
      const result = db.laboratory_results.find((r) => r.lab_request_id === labReq.id);
      if (!result || labReq.status !== 'Completed') {
        res.status(400).json({ error: 'Only completed laboratory reports with recorded findings can be reviewed.' });
        return;
      }
      labReq.status = 'Reviewed';
      result.reviewed_by_doctor = true;
      result.reviewed_at = now;
      result.updated_at = now;
      if (pat?.profile_id) {
        addNotification(db, {
          recipient_user_id: pat.profile_id,
          title: 'Lab Results Reviewed by Consultant',
          message: `Your doctor has reviewed ${labReq.test_name} (${labReq.request_code}).`,
          category: 'laboratory',
          reference_id: labReq.id,
        });
      }
    }

    labReq.updated_at = now;
    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'LAB_UPDATED',
      entity_type: 'laboratory_request',
      entity_id: labReq.request_code,
      details: `Laboratory request status updated to ${labReq.status}.`,
    });
    saveDb(db);
    res.json({ request: labReq });
  });

  // =========================================================================
  // PHARMACY: MEDICATIONS, PRESCRIPTIONS & DISPENSING
  // =========================================================================

  app.get('/api/pharmacy/medications', requireAuth, requireRole('pharmacy', 'doctor', 'nurse', 'admin'), (_req: AuthedRequest, res: Response) => {
    const db = loadDb();
    res.json({ medications: db.medications });
  });

  app.post('/api/pharmacy/medications', requireAuth, requireRole('pharmacy', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const { name, generic_name, category, dosage_form, strength, stock_quantity, reorder_level, unit_label, expiry_date } = req.body ?? {};
    if (!name || !generic_name || !category || !dosage_form || !strength) {
      res.status(400).json({ error: 'All medication specification fields are required.' });
      return;
    }
    const now = new Date().toISOString();
    const sku = `MED-${String(db.medications.length + 1).padStart(3, '0')}`;
    const med = {
      id: crypto.randomUUID(),
      sku,
      name: String(name).trim(),
      generic_name: String(generic_name).trim(),
      category: String(category).trim(),
      dosage_form: String(dosage_form).trim(),
      strength: String(strength).trim(),
      stock_quantity: Math.max(0, Number(stock_quantity || 0)),
      reorder_level: Math.max(0, Number(reorder_level || 20)),
      unit_label: unit_label ? String(unit_label).trim() : 'Packs',
      expiry_date: expiry_date || null,
      created_at: now,
      updated_at: now,
    };
    db.medications.unshift(med);
    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'MEDICATION_ADDED',
      entity_type: 'medication',
      entity_id: sku,
      details: `Added ${med.name} (${med.stock_quantity} ${med.unit_label}) to inventory.`,
    });
    saveDb(db);
    res.status(201).json({ medication: med });
  });

  app.patch('/api/pharmacy/medications/:id', requireAuth, requireRole('pharmacy', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const med = db.medications.find((m) => m.id === req.params.id);
    if (!med) {
      res.status(404).json({ error: 'Medication not found.' });
      return;
    }
    const { stock_quantity, reorder_level, expiry_date } = req.body ?? {};
    if (stock_quantity !== undefined) med.stock_quantity = Math.max(0, Number(stock_quantity));
    if (reorder_level !== undefined) med.reorder_level = Math.max(0, Number(reorder_level));
    if (expiry_date !== undefined) med.expiry_date = expiry_date || null;
    med.updated_at = new Date().toISOString();

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'STOCK_UPDATED',
      entity_type: 'medication',
      entity_id: med.sku,
      details: `Updated ${med.name} stock to ${med.stock_quantity} ${med.unit_label}.`,
    });
    saveDb(db);
    res.json({ medication: med });
  });

  app.get('/api/pharmacy/prescriptions', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    let list = db.prescriptions;

    if (user.role === 'patient') {
      const pat = db.patients.find((p) => p.profile_id === user.id);
      list = pat ? list.filter((p) => p.patient_id === pat.id) : [];
    } else if (!['pharmacy', 'doctor', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const enriched = list.map((rx) => {
      const pat = db.patients.find((p) => p.id === rx.patient_id);
      const doc = db.doctors.find((d) => d.id === rx.doctor_id);
      const docUser = doc ? db.users.find((u) => u.id === doc.profile_id) : null;
      const items = db.prescription_items.filter((it) => it.prescription_id === rx.id);
      const dispensing_records = db.pharmacy_dispensing.filter((d) => d.prescription_id === rx.id);
      return {
        ...rx,
        patient_name: pat?.full_name || 'Unknown',
        patient_hospital_number: pat?.hospital_number || '',
        doctor_name: docUser?.full_name || 'Medical Officer',
        items,
        dispensing_records,
      };
    });
    res.json({ prescriptions: enriched });
  });

  app.post('/api/pharmacy/prescriptions', requireAuth, requireRole('doctor', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const { consultation_id, items } = req.body ?? {};
    const con = db.consultations.find((c) => c.id === consultation_id);
    if (!con) {
      res.status(404).json({ error: 'Consultation not found.' });
      return;
    }
    if (user.role === 'doctor') {
      const docRecord = db.doctors.find((d) => d.profile_id === user.id);
      if (!docRecord || con.doctor_id !== docRecord.id) {
        res.status(403).json({ error: 'Only the attending consultant doctor may issue prescriptions for this consultation.' });
        return;
      }
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'At least one prescribed medication item is required.' });
      return;
    }

    const validatedItems: Array<{
      medication_id: string | null;
      medication_name: string;
      dosage: string;
      frequency: string;
      duration: string;
      quantity_prescribed: number;
      instructions: string | null;
    }> = [];

    for (const item of items) {
      const qty = Number(item.quantity_prescribed);
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
        res.status(400).json({ error: 'Prescribed quantity must be a whole number between 1 and 1000.' });
        return;
      }
      let med = null;
      if (item.medication_id) {
        med = db.medications.find((m) => m.id === item.medication_id) || null;
        if (!med) {
          res.status(400).json({ error: 'Referenced formulary medication does not exist.' });
          return;
        }
      }
      validatedItems.push({
        medication_id: med ? med.id : null,
        medication_name: med ? med.name : String(item.medication_name || 'Prescribed Drug').trim(),
        dosage: String(item.dosage || 'As directed').trim(),
        frequency: String(item.frequency || 'Twice daily').trim(),
        duration: String(item.duration || '5 days').trim(),
        quantity_prescribed: qty,
        instructions: item.instructions ? String(item.instructions).trim() : null,
      });
    }

    const now = new Date().toISOString();
    const code = nextCode('RX', db.prescriptions.map((p) => p.prescription_code));
    const rx = {
      id: crypto.randomUUID(),
      prescription_code: code,
      consultation_id: con.id,
      patient_id: con.patient_id,
      doctor_id: con.doctor_id,
      status: 'Pending' as const,
      pharmacist_notes: null,
      created_at: now,
      updated_at: now,
    };
    db.prescriptions.unshift(rx);

    for (const vItem of validatedItems) {
      db.prescription_items.push({
        id: crypto.randomUUID(),
        prescription_id: rx.id,
        medication_id: vItem.medication_id,
        medication_name: vItem.medication_name,
        dosage: vItem.dosage,
        frequency: vItem.frequency,
        duration: vItem.duration,
        quantity_prescribed: vItem.quantity_prescribed,
        quantity_dispensed: 0,
        availability_status: 'Pending',
        instructions: vItem.instructions,
        created_at: now,
        updated_at: now,
      });
    }

    const pat = db.patients.find((p) => p.id === con.patient_id);
    addNotification(db, {
      recipient_role: 'pharmacy',
      title: 'New Prescription Issued',
      message: `Prescription ${code} issued for ${pat?.full_name || 'Patient'} (${validatedItems.length} medication item(s)).`,
      category: 'pharmacy',
      reference_id: rx.id,
    });
    if (pat?.profile_id) {
      addNotification(db, {
        recipient_user_id: pat.profile_id,
        title: 'New Prescription Issued',
        message: `Your doctor issued prescription ${code}. Proceed to the Pharmacy Dispensary once notified.`,
        category: 'pharmacy',
        reference_id: rx.id,
      });
    }
    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'PRESCRIPTION_ISSUED',
      entity_type: 'prescription',
      entity_id: code,
      details: `Issued ${validatedItems.length} item(s) for ${pat?.full_name || 'Patient'}.`,
    });
    saveDb(db);
    res.status(201).json({ prescription: rx });
  });

  app.patch('/api/pharmacy/prescriptions/:id', requireAuth, requireRole('pharmacy', 'admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const rx = db.prescriptions.find((p) => p.id === req.params.id);
    if (!rx) {
      res.status(404).json({ error: 'Prescription not found.' });
      return;
    }
    if (rx.status === 'Dispensed') {
      res.status(400).json({ error: 'Prescription has already been fully dispensed and cannot be altered.' });
      return;
    }

    const { status, pharmacist_notes, item_updates } = req.body ?? {};
    if (status !== undefined) {
      const nextStatus = String(status) as PrescriptionStatus;
      if (!(nextStatus in ALLOWED_PRESCRIPTION_TRANSITIONS)) {
        res.status(400).json({ error: 'Invalid prescription status.' });
        return;
      }
      if (nextStatus !== rx.status && !ALLOWED_PRESCRIPTION_TRANSITIONS[rx.status].includes(nextStatus)) {
        res.status(400).json({
          error: `Invalid prescription status transition from ${rx.status} to ${nextStatus}.`,
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const rxItems = db.prescription_items.filter((it) => it.prescription_id === rx.id);
    const plannedUpdates: Array<{
      item: (typeof rxItems)[number];
      newDispensed: number;
      delta: number;
      availability_status: (typeof rxItems)[number]['availability_status'];
    }> = [];

    if (Array.isArray(item_updates)) {
      for (const upd of item_updates) {
        const item = rxItems.find((it) => it.id === upd.id);
        if (!item) {
          res.status(404).json({ error: 'Prescription item not found on this prescription.' });
          return;
        }
        const prevDispensed = item.quantity_dispensed;
        let newDispensed = prevDispensed;
        if (upd.quantity_dispensed !== undefined) {
          const parsed = Number(upd.quantity_dispensed);
          if (!Number.isInteger(parsed) || parsed < 0) {
            res.status(400).json({ error: 'Dispensed quantity must be a non-negative whole number.' });
            return;
          }
          if (parsed > item.quantity_prescribed) {
            res.status(400).json({
              error: `Cannot dispense ${parsed} units of ${item.medication_name}; only ${item.quantity_prescribed} prescribed.`,
            });
            return;
          }
          if (parsed < prevDispensed) {
            res.status(400).json({
              error: `Dispensed quantity for ${item.medication_name} cannot be reduced below already-dispensed amount (${prevDispensed}).`,
            });
            return;
          }
          newDispensed = parsed;
        }
        const nextAvail =
          upd.availability_status ||
          (newDispensed >= item.quantity_prescribed ? 'Dispensed' : item.availability_status);
        plannedUpdates.push({
          item,
          newDispensed,
          delta: newDispensed - prevDispensed,
          availability_status: nextAvail,
        });
      }
    } else if (status === 'Dispensed') {
      for (const item of rxItems) {
        const remaining = Math.max(0, item.quantity_prescribed - item.quantity_dispensed);
        plannedUpdates.push({
          item,
          newDispensed: item.quantity_prescribed,
          delta: remaining,
          availability_status: 'Dispensed',
        });
      }
    } else if (status === 'Partially Dispensed') {
      for (const item of rxItems) {
        const remaining = Math.max(0, item.quantity_prescribed - item.quantity_dispensed);
        let delta = 0;
        if (remaining > 0) {
          if (item.medication_id) {
            const med = db.medications.find((m) => m.id === item.medication_id);
            delta = med ? Math.min(remaining, med.stock_quantity) : remaining;
          } else {
            delta = remaining;
          }
        }
        const newDispensed = item.quantity_dispensed + delta;
        plannedUpdates.push({
          item,
          newDispensed,
          delta,
          availability_status:
            newDispensed >= item.quantity_prescribed
              ? 'Dispensed'
              : newDispensed > 0
                ? 'Available'
                : 'Unavailable',
        });
      }
    }

    // Phase 1: Validate aggregate medication stock across ALL planned updates before mutating anything
    const stockNeededByMed = new Map<string, number>();
    for (const plan of plannedUpdates) {
      if (plan.delta > 0 && plan.item.medication_id) {
        stockNeededByMed.set(
          plan.item.medication_id,
          (stockNeededByMed.get(plan.item.medication_id) || 0) + plan.delta
        );
      }
    }
    for (const [medId, totalNeeded] of stockNeededByMed.entries()) {
      const med = db.medications.find((m) => m.id === medId);
      if (med && med.stock_quantity < totalNeeded) {
        res.status(400).json({ error: `Insufficient stock for ${med.name} (${med.stock_quantity} available, ${totalNeeded} required).` });
        return;
      }
    }

    // Check consistency for Partially Dispensed
    if (status === 'Partially Dispensed') {
      const projectedTotalDispensed = rxItems.reduce((sum, it) => {
        const p = plannedUpdates.find((u) => u.item.id === it.id);
        return sum + (p ? p.newDispensed : it.quantity_dispensed);
      }, 0);
      if (projectedTotalDispensed <= 0) {
        res.status(400).json({
          error: 'No medication stock is available to partially dispense. Mark as Unavailable instead.',
        });
        return;
      }
    }

    // Phase 2: Commit stock deductions and item updates atomically
    let totalNewlyDispensed = 0;
    for (const plan of plannedUpdates) {
      if (plan.delta > 0 && plan.item.medication_id) {
        const med = db.medications.find((m) => m.id === plan.item.medication_id);
        if (med) {
          med.stock_quantity -= plan.delta;
          med.updated_at = now;
        }
      }
      totalNewlyDispensed += plan.delta;
      plan.item.quantity_dispensed = plan.newDispensed;
      plan.item.availability_status = plan.availability_status;
      plan.item.updated_at = now;
    }

    // Determine final status consistently with dispensed quantities
    const allItemsFull = rxItems.length > 0 && rxItems.every((it) => it.quantity_dispensed >= it.quantity_prescribed);
    const anyItemDispensed = rxItems.some((it) => it.quantity_dispensed > 0);
    if (status) {
      if (Array.isArray(item_updates) && status === 'Partially Dispensed' && allItemsFull) {
        rx.status = 'Dispensed';
      } else if (status === 'Partially Dispensed' && allItemsFull && !anyItemDispensed) {
        rx.status = 'Pending';
      } else {
        rx.status = status;
      }
    } else if (Array.isArray(item_updates)) {
      if (allItemsFull) rx.status = 'Dispensed';
      else if (anyItemDispensed) rx.status = 'Partially Dispensed';
    }

    if (pharmacist_notes !== undefined) rx.pharmacist_notes = pharmacist_notes ? String(pharmacist_notes).trim() : null;
    rx.updated_at = now;

    if (totalNewlyDispensed > 0 && (rx.status === 'Dispensed' || rx.status === 'Partially Dispensed')) {
      db.pharmacy_dispensing.unshift({
        id: crypto.randomUUID(),
        prescription_id: rx.id,
        dispensed_by: user.id,
        dispensed_by_name: user.full_name,
        dispensed_notes: rx.pharmacist_notes || `Dispensed ${totalNewlyDispensed} unit(s) (${rx.status})`,
        dispensed_at: now,
        created_at: now,
      });
    }

    const pat = db.patients.find((p) => p.id === rx.patient_id);
    if (pat?.profile_id && status) {
      addNotification(db, {
        recipient_user_id: pat.profile_id,
        title: `Prescription ${rx.status}`,
        message: `Your prescription ${rx.prescription_code} is now marked "${rx.status}" at the FUDMA Pharmacy.`,
        category: 'pharmacy',
        reference_id: rx.id,
      });
    }

    addActivityLog(db, {
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'PRESCRIPTION_UPDATED',
      entity_type: 'prescription',
      entity_id: rx.prescription_code,
      details: `Updated prescription status to ${rx.status}.`,
    });
    saveDb(db);
    res.json({ prescription: rx });
  });

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================

  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const list = db.notifications.filter(
      (n) => n.recipient_user_id === user.id || (n.recipient_role && n.recipient_role === user.role)
    );
    res.json({ notifications: list });
  });

  app.patch('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    const notif = db.notifications.find((n) => n.id === req.params.id);
    if (!notif) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    const isOwner = notif.recipient_user_id === user.id;
    const isAuthorizedRole = notif.recipient_role !== null && notif.recipient_role === user.role;
    if (!isOwner && !isAuthorizedRole) {
      res.status(403).json({ error: 'You do not have permission to update this notification.' });
      return;
    }
    notif.is_read = true;
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const user = req.currentUser!;
    for (const n of db.notifications) {
      if (n.recipient_user_id === user.id || (n.recipient_role && n.recipient_role === user.role)) {
        n.is_read = true;
      }
    }
    saveDb(db);
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMINISTRATOR ROUTES (STRICTLY ADMIN-ONLY)
  // =========================================================================

  app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const today = new Date().toISOString().slice(0, 10);
    const staff = db.users
      .filter((u) => u.role !== 'patient')
      .map((u) => {
        const doc = db.doctors.find((d) => d.profile_id === u.id);
        const dept = doc ? db.departments.find((d) => d.id === doc.department_id) : null;
        return {
          id: u.id,
          full_name: u.full_name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          is_active: u.is_active,
          department_id: doc?.department_id || null,
          department_name: dept?.name || null,
          specialization: doc?.specialization || null,
          staff_code: doc?.staff_code || null,
          consultation_room: doc?.consultation_room || null,
          created_at: u.created_at,
        };
      });

    res.json({
      stats: {
        total_patients: db.patients.length,
        total_staff: staff.length,
        total_appointments: db.appointments.length,
        todays_appointments: db.appointments.filter((a) => a.appointment_date === today).length,
        pending_labs: db.laboratory_requests.filter((l) => l.status !== 'Completed' && l.status !== 'Reviewed').length,
        pending_prescriptions: db.prescriptions.filter((p) => p.status === 'Pending').length,
        low_stock_medications: db.medications.filter((m) => m.stock_quantity <= m.reorder_level).length,
      },
      staff,
      departments: db.departments,
      activity_logs: db.activity_logs.slice(0, 100),
      settings: db.system_settings,
    });
  });

  app.post('/api/admin/staff', requireAuth, requireRole('admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const admin = req.currentUser!;
    const {
      full_name,
      email,
      password,
      phone,
      role,
      department_id,
      specialization,
      consultation_room,
    } = req.body ?? {};

    if (!full_name || !email || !password || !role) {
      res.status(400).json({ error: 'Full name, email, temporary password, and role are required.' });
      return;
    }
    const validRoles: UserRole[] = ['nurse', 'lab', 'pharmacy', 'doctor', 'admin'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid staff role selected.' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const newStaff: StoredUser = {
      id: userId,
      full_name: String(full_name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : null,
      gender: null,
      date_of_birth: null,
      address: 'FUDMA Healthcenter Staff',
      is_active: true,
      role,
      password_hash: hashPassword(String(password)),
      created_at: now,
      updated_at: now,
    };
    db.users.unshift(newStaff);

    if (role === 'doctor') {
      const deptId = department_id || db.departments[0]?.id;
      db.doctors.push({
        id: crypto.randomUUID(),
        profile_id: userId,
        department_id: deptId,
        staff_code: `FUDMA-MD-${String(db.doctors.length + 1).padStart(3, '0')}`,
        specialization: specialization ? String(specialization).trim() : 'General Medical Officer',
        license_number: null,
        consultation_room: consultation_room ? String(consultation_room).trim() : `Consult Room ${db.doctors.length + 1}`,
        is_available: true,
        created_at: now,
        updated_at: now,
      });
    }

    addActivityLog(db, {
      actor_id: admin.id,
      actor_name: admin.full_name,
      actor_role: admin.role,
      action: 'STAFF_CREATED',
      entity_type: 'profile',
      entity_id: normalizedEmail,
      details: `Provisioned ${role} account for ${newStaff.full_name}.`,
    });
    saveDb(db);
    res.status(201).json({ ok: true });
  });

  app.patch('/api/admin/staff/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const admin = req.currentUser!;
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Staff account not found.' });
      return;
    }
    const { role, is_active } = req.body ?? {};
    if (target.id === admin.id && (is_active === false || (role && role !== 'admin'))) {
      res.status(400).json({ error: 'Administrators cannot deactivate or demote their own active account.' });
      return;
    }
    if (role !== undefined) {
      const validStaffRoles: UserRole[] = ['nurse', 'lab', 'pharmacy', 'doctor', 'admin'];
      if (!validStaffRoles.includes(role)) {
        res.status(400).json({ error: 'Invalid staff role selected.' });
        return;
      }
      target.role = role;
      if (role === 'doctor' && !db.doctors.some((d) => d.profile_id === target.id)) {
        const now = new Date().toISOString();
        db.doctors.push({
          id: crypto.randomUUID(),
          profile_id: target.id,
          department_id: db.departments[0]?.id || 'd1000000-0000-4000-8000-000000000001',
          staff_code: `FUDMA-MD-${String(db.doctors.length + 1).padStart(3, '0')}`,
          specialization: 'General Medical Officer',
          license_number: null,
          consultation_room: `Consult Room ${db.doctors.length + 1}`,
          is_available: true,
          created_at: now,
          updated_at: now,
        });
      }
    }
    if (typeof is_active === 'boolean') {
      target.is_active = is_active;
    }
    target.updated_at = new Date().toISOString();

    addActivityLog(db, {
      actor_id: admin.id,
      actor_name: admin.full_name,
      actor_role: admin.role,
      action: 'STAFF_UPDATED',
      entity_type: 'profile',
      entity_id: target.email,
      details: `Updated ${target.full_name} (role: ${target.role}, active: ${target.is_active}).`,
    });
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/admin/departments', requireAuth, requireRole('admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const admin = req.currentUser!;
    const { name, code, description, location } = req.body ?? {};
    if (!name || !code) {
      res.status(400).json({ error: 'Department name and code are required.' });
      return;
    }
    const upperCode = String(code).trim().toUpperCase();
    if (db.departments.some((d) => d.code === upperCode)) {
      res.status(409).json({ error: 'Department code already exists.' });
      return;
    }
    const now = new Date().toISOString();
    const dept = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      code: upperCode,
      description: description ? String(description).trim() : null,
      location: location ? String(location).trim() : null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    db.departments.push(dept);
    addActivityLog(db, {
      actor_id: admin.id,
      actor_name: admin.full_name,
      actor_role: admin.role,
      action: 'DEPARTMENT_CREATED',
      entity_type: 'department',
      entity_id: upperCode,
      details: `Added department ${dept.name}.`,
    });
    saveDb(db);
    res.status(201).json({ department: dept });
  });

  app.patch('/api/admin/departments/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const dept = db.departments.find((d) => d.id === req.params.id);
    if (!dept) {
      res.status(404).json({ error: 'Department not found.' });
      return;
    }
    const { is_active, location, description } = req.body ?? {};
    if (typeof is_active === 'boolean') dept.is_active = is_active;
    if (location !== undefined) dept.location = location || null;
    if (description !== undefined) dept.description = description || null;
    dept.updated_at = new Date().toISOString();
    saveDb(db);
    res.json({ department: dept });
  });

  app.patch('/api/admin/settings', requireAuth, requireRole('admin'), (req: AuthedRequest, res: Response) => {
    const db = loadDb();
    const admin = req.currentUser!;
    const { clinic_hours, max_daily_appointments, allow_patient_cancellations, appointment_slot_minutes } = req.body ?? {};

    if (clinic_hours) db.system_settings.clinic_hours = String(clinic_hours).trim();
    if (max_daily_appointments !== undefined) {
      db.system_settings.max_daily_appointments = Math.max(10, Number(max_daily_appointments));
    }
    if (typeof allow_patient_cancellations === 'boolean') {
      db.system_settings.allow_patient_cancellations = allow_patient_cancellations;
    }
    if (appointment_slot_minutes !== undefined) {
      db.system_settings.appointment_slot_minutes = Math.max(10, Number(appointment_slot_minutes));
    }
    db.system_settings.updated_at = new Date().toISOString();

    addActivityLog(db, {
      actor_id: admin.id,
      actor_name: admin.full_name,
      actor_role: admin.role,
      action: 'SETTINGS_UPDATED',
      entity_type: 'system_settings',
      entity_id: db.system_settings.id,
      details: 'Updated hospital scheduling and policy settings.',
    });
    saveDb(db);
    res.json({ settings: db.system_settings });
  });

  // =========================================================================
  // GLOBAL API ERROR HANDLER (SANITIZED)
  // =========================================================================

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Malformed JSON request payload.' });
      return;
    }
    console.error('[SERVER ERROR]', err instanceof Error ? err.message : 'Unknown error');
    res.status(500).json({ error: 'An internal server error occurred.' });
  });

  // =========================================================================
  // VITE / STATIC SERVING
  // =========================================================================

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FUDMA HEALTHCENTER server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FUDMA HEALTHCENTER server:', err);
  process.exit(1);
});
