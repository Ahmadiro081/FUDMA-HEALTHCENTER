import crypto from 'node:crypto';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_FULL_NAME = 'Ahmad Ibrahim';
const TARGET_EMAIL = 'i.ahmad22044@fudutsinma.edu.ng';
const TARGET_USERNAME = 'ENG/2011/0001';
const TARGET_ROLE = 'super_admin' as const;
const TARGET_ACCOUNT_TYPE = 'Privileged Administrative Account';

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

function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Interactive TTY terminal is required to enter password privately.'));
      return;
    }

    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = '';

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (ch === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Provisioning cancelled by operator.'));
        return;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (value.length > 0) value = value.slice(0, -1);
        return;
      }
      value += ch;
    };

    stdin.on('data', onData);
  });
}

async function run(): Promise<void> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  }
  if (isPublicAnonKey(serviceRoleKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be the service_role secret, not an anon key.');
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('Stage 1/7: Running pre-flight safety checks (never overwriting existing accounts)...');

  const [roleCheck, privCheck, whitelistCheck, patientCheck, profileCheck] = await Promise.all([
    supabaseAdmin.from('user_roles').select('user_id').eq('role', TARGET_ROLE).maybeSingle(),
    supabaseAdmin
      .from('privileged_accounts')
      .select('user_id, login_username')
      .eq('login_username', TARGET_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('group11_student_whitelist')
      .select('id')
      .eq('matric_number', TARGET_USERNAME)
      .maybeSingle(),
    supabaseAdmin
      .from('patients')
      .select('id')
      .eq('matric_or_staff_id', TARGET_USERNAME)
      .maybeSingle(),
    supabaseAdmin.from('profiles').select('id').ilike('email', TARGET_EMAIL).maybeSingle(),
  ]);

  if (
    roleCheck.error ||
    privCheck.error ||
    whitelistCheck.error ||
    patientCheck.error ||
    profileCheck.error
  ) {
    throw new Error(
      `Pre-flight query failed: ${
        roleCheck.error?.message ||
        privCheck.error?.message ||
        whitelistCheck.error?.message ||
        patientCheck.error?.message ||
        profileCheck.error?.message
      }`
    );
  }

  if (roleCheck.data) {
    throw new Error('Aborted: A super_admin account already exists in public.user_roles.');
  }
  if (privCheck.data) {
    throw new Error(`Aborted: Username ${TARGET_USERNAME} already exists in public.privileged_accounts.`);
  }
  if (whitelistCheck.data || patientCheck.data) {
    throw new Error(`Aborted: ${TARGET_USERNAME} exists in student/patient records.`);
  }
  if (profileCheck.data) {
    throw new Error(`Aborted: Email ${TARGET_EMAIL} already exists in public.profiles.`);
  }

  let page = 1;
  while (page <= 10) {
    const { data: usersPage, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listErr) throw new Error(`Auth lookup failed: ${listErr.message}`);
    const match = usersPage.users.find(
      (u) => (u.email || '').trim().toLowerCase() === TARGET_EMAIL
    );
    if (match) {
      throw new Error(`Aborted: Email ${TARGET_EMAIL} already exists in auth.users (ID: ${match.id}).`);
    }
    if (usersPage.users.length < 200) break;
    page += 1;
  }

  console.log('Stage 2/7: Reading private password...');
  const password = await promptHidden(`Enter private password for ${TARGET_EMAIL} (min 8 chars): `);
  const confirm = await promptHidden('Confirm password: ');
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (password !== confirm) {
    throw new Error('Passwords do not match.');
  }

  // Generate cryptographically random one-time token in memory only (never logged or saved)
  const rawSetupToken = crypto.randomBytes(32).toString('hex');
  const setupTokenHash = crypto.createHash('sha256').update(rawSetupToken, 'utf8').digest('hex');

  console.log('\nRun the temporary handle_new_user() SQL with this SHA-256 hash:');
  console.log(`  ${setupTokenHash}`);
  await promptLine('Press Enter after applying the temporary handle_new_user() SQL in Supabase... ');

  console.log('Stage 3/7: Creating Auth user via Supabase Auth Admin API...');
  const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: TARGET_EMAIL,
    password,
    email_confirm: false,
    ban_duration: '15m',
    app_metadata: {
      account_origin: 'super_admin_provision',
      privileged_username: TARGET_USERNAME,
      account_type: TARGET_ACCOUNT_TYPE,
    },
    user_metadata: {
      full_name: TARGET_FULL_NAME,
      setup_token: rawSetupToken,
    },
  });

  if (createErr || !createdAuth.user) {
    throw new Error(`Auth user creation failed: ${createErr?.message || 'No user returned.'}`);
  }

  const userId = createdAuth.user.id;

  try {
    console.log('Stage 4/7: Scrubbing setup token from user metadata...');
    const { data: scrubbed, error: scrubErr } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: {
          full_name: TARGET_FULL_NAME,
          setup_token: null,
        },
      }
    );
    if (scrubErr || scrubbed.user?.user_metadata?.setup_token != null) {
      throw new Error(`Metadata scrub failed: ${scrubErr?.message || 'Token still present.'}`);
    }

    console.log('Stage 5/7: Verifying profile & assigning super_admin role...');
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        full_name: TARGET_FULL_NAME,
        email: TARGET_EMAIL,
        address: 'FUDMA Healthcenter Executive Administration',
        is_active: true,
      },
      { onConflict: 'id' }
    );
    if (profErr) throw new Error(`Profile upsert failed: ${profErr.message}`);

    const { error: roleErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: userId,
        role: TARGET_ROLE,
        assigned_by: userId,
      },
      { onConflict: 'user_id' }
    );
    if (roleErr) throw new Error(`Role assignment failed: ${roleErr.message}`);

    const { data: verifiedRole, error: verifyRoleErr } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    if (verifyRoleErr || verifiedRole?.role !== TARGET_ROLE) {
      throw new Error('Role verification failed: super_admin was not persisted.');
    }

    console.log('Stage 6/7: Creating & verifying privileged_accounts record...');
    const { error: privErr } = await supabaseAdmin.from('privileged_accounts').insert({
      user_id: userId,
      login_username: TARGET_USERNAME,
      role: TARGET_ROLE,
      account_type: TARGET_ACCOUNT_TYPE,
      is_immutable: true,
    });
    if (privErr) throw new Error(`Privileged account insert failed: ${privErr.message}`);

    const { data: verifiedPriv, error: verifyPrivErr } = await supabaseAdmin
      .from('privileged_accounts')
      .select('login_username, role')
      .eq('user_id', userId)
      .single();
    if (verifyPrivErr || verifiedPriv?.login_username !== TARGET_USERNAME) {
      throw new Error('Privileged account verification failed.');
    }

    console.log('Stage 7/7: Confirming email, lifting temporary ban, and writing audit log...');
    const { error: activateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      ban_duration: 'none',
    });
    if (activateErr) throw new Error(`Account activation failed: ${activateErr.message}`);

    await supabaseAdmin.from('activity_logs').insert({
      actor_id: userId,
      actor_name: TARGET_FULL_NAME,
      actor_role: TARGET_ROLE,
      action: 'SUPER_ADMIN_PROVISIONED',
      entity_type: 'privileged_account',
      entity_id: TARGET_USERNAME,
      details: `Provisioned one-time Super Admin (${TARGET_USERNAME}) via Admin API script.`,
    });

    console.log('\nProvisioning complete:');
    console.log(`  User ID:  ${userId}`);
    console.log(`  Email:    ${TARGET_EMAIL}`);
    console.log(`  Username: ${TARGET_USERNAME}`);
    console.log(`  Role:     ${TARGET_ROLE}`);
    console.log('\nNext: Run the restore handle_new_user() SQL in Supabase SQL Editor.');
  } catch (err) {
    console.error('\nStage failed, rolling back newly created Auth user...');
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
