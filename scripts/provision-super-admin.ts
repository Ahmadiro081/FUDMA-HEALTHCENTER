import dotenv from 'dotenv';
import readline from 'node:readline';
import {
  SUPER_ADMIN_ACCOUNT_TYPE,
  SUPER_ADMIN_USERNAME,
  executeSupabaseSuperAdminProvision,
  validateSuperAdminPassword,
} from '../api/admin/provision-super-admin.ts';

dotenv.config();

function promptLine(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });

    if (hidden && process.stdin.isTTY) {
      const stdoutWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
        if (str.includes(question) || str === '\n' || str === '\r\n') {
          return stdoutWrite(chunk);
        }
        return true;
      }) as typeof process.stdout.write;

      rl.question(question, (answer) => {
        process.stdout.write = stdoutWrite;
        process.stdout.write('\n');
        rl.close();
        resolve(answer);
      });
      return;
    }

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceRoleKey || serviceRoleKey.length < 20) {
    console.error(
      'ERROR: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be configured in your environment before running this script.'
    );
    process.exit(1);
  }
  const keyParts = serviceRoleKey.split('.');
  let isAnonJwt = serviceRoleKey.startsWith('sb_publishable_');
  if (!isAnonJwt && keyParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(keyParts[1], 'base64url').toString('utf-8')) as {
        role?: string;
      };
      isAnonJwt = payload.role === 'anon';
    } catch {
      // Ignore malformed JWT parsing
    }
  }
  if (isAnonJwt) {
    console.error(
      'ERROR: SUPABASE_SERVICE_ROLE_KEY is set to a public anon/publishable key. Replace it with the secret service_role key from Supabase Project Settings -> API.'
    );
    process.exit(1);
  }

  console.log('=== FUDMA HEALTHCENTER Secure Super Admin Provisioning ===');
  console.log(`Login Username : ${SUPER_ADMIN_USERNAME}`);
  console.log(`Account Type   : ${SUPER_ADMIN_ACCOUNT_TYPE}`);
  console.log('Role           : super_admin');
  console.log('');

  const email =
    process.env.SUPER_ADMIN_EMAIL?.trim() ||
    (await promptLine('Super Admin Institutional Email: ')).trim();
  const fullName =
    process.env.SUPER_ADMIN_NAME?.trim() ||
    (await promptLine('Super Admin Full Name [FUDMA Healthcenter Super Admin]: ')).trim() ||
    'FUDMA Healthcenter Super Admin';
  const phone =
    process.env.SUPER_ADMIN_PHONE?.trim() ||
    (await promptLine('Contact Phone (optional): ')).trim() ||
    null;

  let password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (!password) {
    password = await promptLine('Enter private Super Admin password (min 8 chars): ', true);
    const confirm = await promptLine('Confirm private Super Admin password: ', true);
    if (password !== confirm) {
      console.error('ERROR: Passwords do not match.');
      process.exit(1);
    }
  }

  const passErr = validateSuperAdminPassword(password);
  if (passErr) {
    console.error(`ERROR: ${passErr}`);
    process.exit(1);
  }

  const result = await executeSupabaseSuperAdminProvision({
    supabaseUrl,
    serviceRoleKey,
    email,
    password,
    fullName,
    phone,
  });

  if (result.status !== 201) {
    console.error('PROVISIONING FAILED:', result.payload.error || 'Unknown error');
    process.exit(1);
  }

  console.log('');
  console.log('SUCCESS: Initial Super Admin provisioned cleanly.');
  console.log(`User ID        : ${String(result.payload.user_id)}`);
  console.log(`Login Username : ${SUPER_ADMIN_USERNAME}`);
  console.log('Role           : super_admin');
  console.log('Audit Event    : SUPER_ADMIN_PROVISIONED recorded.');
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
