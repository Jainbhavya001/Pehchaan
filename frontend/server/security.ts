import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getNeonPool, initNeonSchema } from './neon.ts';

export interface AuthPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  checkpointIds: string[];
  fp?: string;
  mustChangePassword?: boolean;
}

// Passwords the old "Create Admin Account" button set. Any account still
// using one is forced to choose a new password at its next sign-in.
const PUBLISHED_DEFAULTS = ['admin123', 'officer123', 'incharge123'];

export const MIN_PASSWORD_LENGTH = 12;

let setupCode: string | null = null;

async function db() {
  const pool = getNeonPool();
  if (!pool) throw new Error('Database not connected');
  await initNeonSchema();
  return pool;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (PUBLISHED_DEFAULTS.includes(password.toLowerCase())) return 'That password is published; choose another.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers.';
  return null;
}

/** Runs at start-up: issues a one-time setup code on an empty database and
 *  flags any account that still uses a published default password. */
export async function securityStartup(): Promise<void> {
  const pool = getNeonPool();
  if (!pool) return;
  try {
    await initNeonSchema();
    const users = (await pool.query('SELECT id, email, password_hash, must_change_password FROM pehchaan_users')).rows;
    if (users.length === 0) {
      setupCode = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
      console.log('\n==================================================================');
      console.log(`  FIRST-TIME SETUP CODE: ${setupCode}`);
      console.log('  Enter it on the sign-in page ("First-time setup") to create the admin.');
      console.log('==================================================================\n');
      return;
    }
    for (const u of users) {
      if (u.must_change_password) continue;
      for (const weak of PUBLISHED_DEFAULTS) {
        if (await bcrypt.compare(weak, u.password_hash)) {
          await pool.query('UPDATE pehchaan_users SET must_change_password = true WHERE id = $1', [u.id]);
          console.warn(`Account ${u.email} uses a published default password; it must be changed at next sign-in.`);
          break;
        }
      }
    }
  } catch (err) {
    console.error('Security start-up checks failed:', err);
  }
}

export function setupAvailable(): boolean {
  return setupCode !== null;
}

export async function completeSetup(body: any): Promise<{ email: string }> {
  if (!setupCode) throw Object.assign(new Error('Setup has already been completed.'), { status: 409 });
  const code = String(body?.setupCode || '').trim().toUpperCase();
  if (code.length !== setupCode.length || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(setupCode))) {
    throw Object.assign(new Error('Setup code is incorrect. It is printed in the server console.'), { status: 403 });
  }
  const email = String(body?.email || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name) throw Object.assign(new Error('Name and a valid email are required.'), { status: 400 });
  const problem = passwordProblem(body?.password);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });

  const pool = await db();
  await pool.query(
    `INSERT INTO pehchaan_checkpoints (id, name, location, type) VALUES ('CP-001', 'Checkpoint 1', NULL, 'ICP')
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO pehchaan_users (id, email, name, password_hash, role, checkpoint_ids)
     VALUES ($1, $2, $3, $4, 'ADMIN', '{}')`,
    [`USR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, email, name, await bcrypt.hash(body.password, 12)],
  );
  setupCode = null;
  return { email };
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const pool = await db();
  const row = (await pool.query('SELECT password_hash FROM pehchaan_users WHERE id = $1', [userId])).rows[0];
  if (!row || !(await bcrypt.compare(String(current || ''), row.password_hash))) {
    throw Object.assign(new Error('Current password is incorrect.'), { status: 403 });
  }
  const problem = passwordProblem(next);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  if (await bcrypt.compare(next, row.password_hash)) throw Object.assign(new Error('Choose a password you have not used here.'), { status: 400 });
  await pool.query('UPDATE pehchaan_users SET password_hash = $1, must_change_password = false WHERE id = $2', [await bcrypt.hash(next, 12), userId]);
}

// ---- User management (ADMIN) ----

export async function listUsers() {
  const pool = await db();
  return (await pool.query(
    'SELECT id, email, name, role, checkpoint_ids, must_change_password, COALESCE(active, true) AS active, created_at FROM pehchaan_users ORDER BY created_at',
  )).rows;
}

const ROLES = ['OFFICER', 'POST_INCHARGE', 'ADMIN'];

/** Creates a user with a random one-time password they must change at first sign-in. */
export async function createUser(body: any): Promise<{ id: string; email: string; temporaryPassword: string }> {
  const email = String(body?.email || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  const role = String(body?.role || '');
  const checkpointIds: string[] = Array.isArray(body?.checkpointIds) ? body.checkpointIds.map(String) : [];
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name) throw Object.assign(new Error('Name and a valid email are required.'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Unknown role.'), { status: 400 });
  if (role !== 'ADMIN' && checkpointIds.length === 0) throw Object.assign(new Error('Assign at least one checkpoint.'), { status: 400 });
  const pool = await db();
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const id = `USR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    await pool.query(
      `INSERT INTO pehchaan_users (id, email, name, password_hash, role, checkpoint_ids, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [id, email, name, await bcrypt.hash(temporaryPassword, 12), role, checkpointIds],
    );
  } catch (err: any) {
    if (err?.code === '23505') throw Object.assign(new Error('A user with that email already exists.'), { status: 409 });
    throw err;
  }
  return { id, email, temporaryPassword };
}

export async function setUserActive(id: string, active: boolean) {
  const pool = await db();
  await pool.query('UPDATE pehchaan_users SET active = $1 WHERE id = $2', [active, id]);
}

export async function resetUserPassword(id: string): Promise<string> {
  const pool = await db();
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const res = await pool.query(
    'UPDATE pehchaan_users SET password_hash = $1, must_change_password = true WHERE id = $2',
    [await bcrypt.hash(temporaryPassword, 12), id],
  );
  if (!res.rowCount) throw Object.assign(new Error('User not found.'), { status: 404 });
  return temporaryPassword;
}

export async function addCheckpoint(body: any) {
  const id = String(body?.id || '').trim().toUpperCase();
  const name = String(body?.name || '').trim();
  if (!/^[A-Z0-9-]{2,32}$/.test(id) || !name) throw Object.assign(new Error('Checkpoint ID (A-Z, 0-9, -) and name are required.'), { status: 400 });
  const pool = await db();
  await pool.query(
    'INSERT INTO pehchaan_checkpoints (id, name, location, type) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location',
    [id, name, body?.location || null, body?.type || null],
  );
}

// ---- Checkpoint scoping ----

/** Checkpoints a user may see; null means all (ADMIN). */
export function scopeOf(user: AuthPayload): string[] | null {
  return user.role === 'ADMIN' ? null : user.checkpointIds || [];
}

export function inScope(user: AuthPayload, checkpointId?: string | null): boolean {
  const scope = scopeOf(user);
  return scope === null || (!!checkpointId && scope.includes(checkpointId));
}
