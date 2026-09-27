import { Pool } from 'pg';
import dotenv from 'dotenv';
import {
  GENESIS_HASH,
  computeScanHash,
  abbreviateHash,
  signAuditLog,
  sanitizeScanInput,
} from './hashchain.ts';

dotenv.config();

// Types for database records
export interface DbScanRecord {
  id: string;
  document_type: string;
  doc_code: string;
  country_code: string;
  country_name: string;
  presenter_name: string;
  risk_score: number;
  risk_verdict: string;
  checksum_status: string;
  findings: string;
  timestamp: string;
  local_time: string;
  lane: string;
  officer: string;
  officer_uid: string;
  hash_proof: string;
  full_hash: string;
  block_height: string;
  flag_reason?: string;
  mrz_string?: string;
  mrz_line2?: string;
  doc_number?: string;
  dob?: string;
  expiry_visual?: string;
  expiry_mrz?: string;
  face_match_rate?: string;
  ela_anomaly_rate?: string;
  remote_station_id?: string;
  sync_status?: string;
  checkpoint_id?: string;
  analysis?: any;
  doc_number_hash?: string;
  provenance_hash?: string;
  image_fingerprint?: string;
  has_analysis?: boolean;
  created_at?: string;
}

export interface DbAuditLog {
  id?: number;
  action: string;
  officer: string;
  officer_uid: string;
  target_id: string;
  remote_station: string;
  details: string;
  hash_proof: string;
  created_at?: string;
}

let inMemoryScans: DbScanRecord[] = [];
let inMemoryAuditLogs: DbAuditLog[] = [];

let neonPool: Pool | null = null;
let schemaInitialized = false;

export function getNeonConnectionString(): string | null {
  return process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || null;
}

export function getNeonPool(): Pool | null {
  const connStr = getNeonConnectionString();
  if (!connStr) {
    return null;
  }

  if (!neonPool) {
    neonPool = new Pool({
      connectionString: connStr,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    neonPool.on('error', (err) => {
      console.error('Unexpected error on idle Neon PostgreSQL client:', err);
    });
  }

  return neonPool;
}

let schemaPromise: Promise<boolean> | null = null;

export async function initNeonSchema(): Promise<boolean> {
  if (schemaInitialized) return true;
  if (!schemaPromise) schemaPromise = createSchema().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

async function createSchema(): Promise<boolean> {
  const pool = getNeonPool();
  if (!pool) return false;

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS pehchaan_scans (
          id VARCHAR(64) PRIMARY KEY,
          document_type VARCHAR(64),
          doc_code VARCHAR(64),
          country_code VARCHAR(16),
          country_name VARCHAR(128),
          presenter_name VARCHAR(255),
          risk_score INTEGER,
          risk_verdict VARCHAR(32),
          checksum_status VARCHAR(16),
          findings TEXT,
          timestamp VARCHAR(64),
          local_time VARCHAR(64),
          lane VARCHAR(64),
          officer VARCHAR(128),
          officer_uid VARCHAR(64),
          hash_proof VARCHAR(64),
          full_hash VARCHAR(128),
          block_height VARCHAR(64),
          flag_reason TEXT,
          mrz_string TEXT,
          mrz_line2 TEXT,
          doc_number VARCHAR(64),
          dob VARCHAR(32),
          expiry_visual VARCHAR(64),
          expiry_mrz VARCHAR(64),
          face_match_rate VARCHAR(32),
          ela_anomaly_rate VARCHAR(32),
          remote_station_id VARCHAR(64),
          prev_hash VARCHAR(128),
          sync_status VARCHAR(32) DEFAULT 'SYNCED',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_audit_logs (
          id SERIAL PRIMARY KEY,
          action VARCHAR(128),
          officer VARCHAR(128),
          officer_uid VARCHAR(64),
          target_id VARCHAR(64),
          remote_station VARCHAR(64),
          details TEXT,
          hash_proof VARCHAR(128),
          hmac_signature VARCHAR(128),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_chain_anchor (
          id SERIAL PRIMARY KEY,
          genesis_hash VARCHAR(128) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_telemetry (
          id SERIAL PRIMARY KEY,
          station_id VARCHAR(64),
          bandwidth_mode VARCHAR(32),
          network_status VARCHAR(32),
          pending_queue_count INTEGER,
          synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_users (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(32) NOT NULL CHECK (role IN ('OFFICER','POST_INCHARGE','ADMIN')),
          checkpoint_ids TEXT[] DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_checkpoints (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          location VARCHAR(255),
          type VARCHAR(64)
        );

        CREATE TABLE IF NOT EXISTS pehchaan_system_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          actor VARCHAR(255),
          role VARCHAR(32),
          checkpoint VARCHAR(64),
          event VARCHAR(128),
          status VARCHAR(32),
          reference_id VARCHAR(64)
        );
      `);

      await client.query(`
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(128);
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS checkpoint_id VARCHAR(64);
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS analysis JSONB;
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS doc_number_hash VARCHAR(64);
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS provenance_hash VARCHAR(64);
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS image_fingerprint VARCHAR(96);
        ALTER TABLE pehchaan_scans ADD COLUMN IF NOT EXISTS batch_id INTEGER;
        CREATE INDEX IF NOT EXISTS idx_scans_doc_hash ON pehchaan_scans (doc_number_hash);
        ALTER TABLE pehchaan_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
        ALTER TABLE pehchaan_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
        ALTER TABLE pehchaan_checkpoints ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
        ALTER TABLE pehchaan_checkpoints ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
        ALTER TABLE pehchaan_checkpoints ADD COLUMN IF NOT EXISTS radius_km DOUBLE PRECISION DEFAULT 5;

        CREATE TABLE IF NOT EXISTS pehchaan_decisions (
          id SERIAL PRIMARY KEY,
          scan_id VARCHAR(64) NOT NULL,
          decision VARCHAR(16) NOT NULL,
          status VARCHAR(24) NOT NULL,
          officer VARCHAR(128), officer_uid VARCHAR(64), notes TEXT,
          cosigner VARCHAR(128), cosigner_uid VARCHAR(64), cosign_notes TEXT, cosigned_at TIMESTAMP WITH TIME ZONE,
          system_verdict VARCHAR(32), system_score INTEGER, checkpoint_id VARCHAR(64),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_forgery_registry (
          id SERIAL PRIMARY KEY,
          page_hash VARCHAR(64) NOT NULL,
          portrait_hash VARCHAR(16),
          tamper_types TEXT,
          doc_type VARCHAR(32),
          checkpoint_id VARCHAR(64),
          source_scan VARCHAR(64),
          prev_hash VARCHAR(128), entry_hash VARCHAR(128),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_anchor_batches (
          id SERIAL PRIMARY KEY,
          merkle_root VARCHAR(64) NOT NULL,
          leaf_count INTEGER NOT NULL,
          first_scan VARCHAR(64), last_scan VARCHAR(64),
          signature TEXT NOT NULL,
          public_key TEXT NOT NULL,
          external_proof TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE pehchaan_audit_logs ADD COLUMN IF NOT EXISTS hmac_signature VARCHAR(128);
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS pehchaan_ref_datasets (
          id VARCHAR(16) PRIMARY KEY,
          name TEXT NOT NULL,
          source VARCHAR(128),
          category VARCHAR(32),
          data_gov_resource VARCHAR(128),
          downloads INTEGER DEFAULT 0,
          use_description TEXT,
          roles TEXT[] DEFAULT '{}',
          ui_location TEXT,
          status VARCHAR(16) DEFAULT 'pending',
          last_ingested TIMESTAMP WITH TIME ZONE,
          record_count INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_ref_passport_volumes (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER,
          week INTEGER,
          applications_filed INTEGER,
          passports_issued INTEGER,
          source_dataset VARCHAR(16),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_ref_fta_arrivals (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER,
          nationality VARCHAR(64),
          nationality_code VARCHAR(8),
          arrival_count INTEGER,
          purpose VARCHAR(64),
          source_dataset VARCHAR(16),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_ref_border_stats (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER,
          border VARCHAR(64) NOT NULL,
          incident_type VARCHAR(64),
          count INTEGER DEFAULT 0,
          source_dataset VARCHAR(16),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_ref_fraud_stats (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          category VARCHAR(64) NOT NULL,
          subcategory VARCHAR(128),
          count INTEGER DEFAULT 0,
          amount_crore NUMERIC(12,2),
          source_dataset VARCHAR(16),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pehchaan_ref_aadhaar_stats (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER,
          state VARCHAR(64),
          gender VARCHAR(16),
          age_group VARCHAR(32),
          count BIGINT DEFAULT 0,
          metric_type VARCHAR(32),
          source_dataset VARCHAR(16),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      const anchorRes = await client.query('SELECT COUNT(*) FROM pehchaan_chain_anchor');
      if (parseInt(anchorRes.rows[0].count, 10) === 0) {
        await client.query(
          'INSERT INTO pehchaan_chain_anchor (genesis_hash) VALUES ($1)',
          [GENESIS_HASH]
        );
      }

      schemaInitialized = true;
      console.log('Neon PostgreSQL schema verified. Hash chain anchor seeded.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to initialize Neon schema:', err);
    return false;
  }
}

export async function getNeonStatus() {
  const connStr = getNeonConnectionString();
  const isConfigured = !!connStr;

  if (!isConfigured) {
    return {
      connected: false,
      configured: false,
      provider: 'Neon Serverless PostgreSQL',
      project: '(not configured)',
      projectUrl: '',
      host: 'Database connection not configured',
      database: 'neondb (Store-and-Forward Active)',
      totalScans: inMemoryScans.length,
      totalAuditLogs: inMemoryAuditLogs.length,
      latencyMs: 1,
      mode: 'REMOTE_STORE_AND_FORWARD_READY',
      message: 'Set NEON_DATABASE_URL environment variable to connect to Neon PostgreSQL.',
    };
  }

  const pool = getNeonPool();
  if (!pool) {
    return {
      connected: false,
      configured: true,
      provider: 'Neon Serverless PostgreSQL',
      host: 'Configured',
      database: 'Unknown',
      totalScans: inMemoryScans.length,
      totalAuditLogs: inMemoryAuditLogs.length,
      latencyMs: 0,
      mode: 'CONNECTING',
      message: 'Initializing connection to Neon PostgreSQL...',
    };
  }

  const startTime = Date.now();
  try {
    if (!schemaInitialized) {
      await initNeonSchema();
    }
    const client = await pool.connect();
    try {
      const scanCountRes = await client.query('SELECT COUNT(*) FROM pehchaan_scans');
      const auditCountRes = await client.query('SELECT COUNT(*) FROM pehchaan_audit_logs');
      const latencyMs = Date.now() - startTime;

      let host = 'ep-neon.us-east-2.aws.neon.tech';
      let dbName = 'neondb';
      try {
        const parsed = new URL(connStr!);
        host = parsed.hostname;
        dbName = parsed.pathname.replace('/', '') || 'neondb';
      } catch {
        // ignore url parsing error
      }

      return {
        connected: true,
        configured: true,
        provider: 'Neon Serverless PostgreSQL',
        host,
        database: dbName,
        totalScans: parseInt(scanCountRes.rows[0].count, 10),
        totalAuditLogs: parseInt(auditCountRes.rows[0].count, 10),
        latencyMs,
        mode: 'CLOUD_NEON_SYNCHRONIZED',
        message: 'Direct live synchronization active to Neon PostgreSQL.',
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      connected: false,
      configured: true,
      provider: 'Neon Serverless PostgreSQL',
      host: 'Error connecting to host',
      database: 'neondb',
      totalScans: inMemoryScans.length,
      totalAuditLogs: inMemoryAuditLogs.length,
      latencyMs: Date.now() - startTime,
      mode: 'OFFLINE_RETRY',
      message: err?.message || 'Connection failed, running in store-and-forward mode.',
    };
  }
}

// ---- Auth helpers ----

export interface DbUser {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  checkpoint_ids: string[];
  created_at?: string;
}

export interface DbCheckpoint {
  id: string;
  name: string;
  location?: string;
  type?: string;
}

export interface DbSystemLog {
  id?: number;
  timestamp?: string;
  actor: string;
  role: string;
  checkpoint: string;
  event: string;
  status: string;
  reference_id?: string;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const pool = getNeonPool();
  if (!pool) return null;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM pehchaan_users WHERE email = $1', [email]);
      return res.rows[0] || null;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

export async function countUsers(): Promise<number> {
  const pool = getNeonPool();
  if (!pool) return -1;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT COUNT(*) FROM pehchaan_users');
      return parseInt(res.rows[0].count, 10);
    } finally {
      client.release();
    }
  } catch {
    return -1;
  }
}

export async function createUser(user: Omit<DbUser, 'created_at'>): Promise<DbUser> {
  const pool = getNeonPool();
  if (!pool) throw new Error('Database not connected');
  if (!schemaInitialized) await initNeonSchema();
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO pehchaan_users (id, email, name, password_hash, role, checkpoint_ids)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.id, user.email, user.name, user.password_hash, user.role, user.checkpoint_ids]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

export async function insertCheckpoint(cp: DbCheckpoint): Promise<void> {
  const pool = getNeonPool();
  if (!pool) return;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO pehchaan_checkpoints (id, name, location, type) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [cp.id, cp.name, cp.location || null, cp.type || null]
      );
    } finally {
      client.release();
    }
  } catch {}
}

export async function fetchCheckpoints(): Promise<DbCheckpoint[]> {
  const pool = getNeonPool();
  if (!pool) return [];
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM pehchaan_checkpoints ORDER BY name');
      return res.rows;
    } finally {
      client.release();
    }
  } catch {
    return [];
  }
}

export async function insertSystemLog(log: DbSystemLog): Promise<void> {
  const pool = getNeonPool();
  if (!pool) return;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO pehchaan_system_logs (actor, role, checkpoint, event, status, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [log.actor, log.role, log.checkpoint, log.event, log.status, log.reference_id || null]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to insert system log:', err);
  }
}

export async function fetchSystemLogs(filters?: {
  search?: string;
  event?: string;
  limit?: number;
}): Promise<DbSystemLog[]> {
  const pool = getNeonPool();
  if (!pool) return [];
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM pehchaan_system_logs WHERE 1=1';
      const params: any[] = [];
      let idx = 1;
      if (filters?.search) {
        query += ` AND (actor ILIKE $${idx} OR event ILIKE $${idx} OR reference_id ILIKE $${idx})`;
        params.push(`%${filters.search}%`);
        idx++;
      }
      if (filters?.event) {
        query += ` AND event = $${idx}`;
        params.push(filters.event);
        idx++;
      }
      query += ` ORDER BY timestamp DESC LIMIT $${idx}`;
      params.push(filters?.limit || 100);
      const res = await client.query(query, params);
      return res.rows;
    } finally {
      client.release();
    }
  } catch {
    return [];
  }
}

// ---- Scans ----

export async function fetchAllScans(): Promise<DbScanRecord[]> {
  const pool = getNeonPool();
  if (!pool) {
    return inMemoryScans;
  }

  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT id, document_type, doc_code, country_code, country_name, presenter_name, risk_score,
               risk_verdict, checksum_status, findings, timestamp, local_time, lane, officer, officer_uid,
               hash_proof, full_hash, block_height, flag_reason, mrz_string, mrz_line2, doc_number, dob,
               expiry_visual, expiry_mrz, face_match_rate, ela_anomaly_rate, remote_station_id,
               sync_status, checkpoint_id, (analysis IS NOT NULL) AS has_analysis, created_at
        FROM pehchaan_scans ORDER BY created_at DESC LIMIT 200
      `);
      if (res.rows.length === 0) {
        return inMemoryScans;
      }
      return res.rows.map(row => ({
        id: row.id,
        document_type: row.document_type,
        doc_code: row.doc_code,
        country_code: row.country_code,
        country_name: row.country_name,
        presenter_name: row.presenter_name,
        risk_score: row.risk_score,
        risk_verdict: row.risk_verdict,
        checksum_status: row.checksum_status,
        findings: row.findings,
        timestamp: row.timestamp,
        local_time: row.local_time,
        lane: row.lane,
        officer: row.officer,
        officer_uid: row.officer_uid,
        hash_proof: row.hash_proof,
        full_hash: row.full_hash,
        block_height: row.block_height,
        flag_reason: row.flag_reason,
        mrz_string: row.mrz_string,
        mrz_line2: row.mrz_line2,
        doc_number: row.doc_number,
        dob: row.dob,
        expiry_visual: row.expiry_visual,
        expiry_mrz: row.expiry_mrz,
        face_match_rate: row.face_match_rate,
        ela_anomaly_rate: row.ela_anomaly_rate,
        remote_station_id: row.remote_station_id,
        sync_status: row.sync_status || 'SYNCED',
        checkpoint_id: row.checkpoint_id,
        has_analysis: row.has_analysis,
        created_at: row.created_at,
      }));
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('Neon query failed, using in-memory store-and-forward fallback:', err);
    return inMemoryScans;
  }
}

export async function insertScan(scan: DbScanRecord): Promise<DbScanRecord> {
  const sanitized = sanitizeScanInput(scan) as DbScanRecord;

  const pool = getNeonPool();
  if (!pool) {
    const prevHash = inMemoryScans.length > 0 ? inMemoryScans[0].full_hash : GENESIS_HASH;
    const blockHeight = inMemoryScans.length + 1;
    const fullHash = computeScanHash(prevHash, sanitized);
    const enriched = {
      ...sanitized,
      full_hash: fullHash,
      hash_proof: abbreviateHash(fullHash),
      block_height: `#${blockHeight}`,
      prev_hash: prevHash,
      sync_status: 'QUEUED_LOCAL',
    } as DbScanRecord & { prev_hash: string };
    inMemoryScans.unshift(enriched);
    return enriched;
  }

  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lastRow = await client.query(
        'SELECT full_hash, block_height FROM pehchaan_scans ORDER BY created_at DESC LIMIT 1'
      );
      let prevHash = GENESIS_HASH;
      let blockHeight = 1;
      if (lastRow.rows.length > 0) {
        prevHash = lastRow.rows[0].full_hash;
        const prev = parseInt(String(lastRow.rows[0].block_height).replace('#', ''), 10);
        blockHeight = (Number.isFinite(prev) ? prev : 0) + 1;
      }

      const fullHash = computeScanHash(prevHash, sanitized);
      const hashProof = abbreviateHash(fullHash);

      await client.query(`
        INSERT INTO pehchaan_scans (
          id, document_type, doc_code, country_code, country_name, presenter_name,
          risk_score, risk_verdict, checksum_status, findings, timestamp, local_time,
          lane, officer, officer_uid, hash_proof, full_hash, block_height, flag_reason,
          mrz_string, mrz_line2, doc_number, dob, expiry_visual, expiry_mrz,
          face_match_rate, ela_anomaly_rate, remote_station_id, prev_hash, sync_status,
          checkpoint_id, analysis, doc_number_hash, provenance_hash, image_fingerprint
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35
        )
        ON CONFLICT (id) DO UPDATE SET
          risk_score = EXCLUDED.risk_score,
          risk_verdict = EXCLUDED.risk_verdict,
          checksum_status = EXCLUDED.checksum_status,
          findings = EXCLUDED.findings,
          full_hash = EXCLUDED.full_hash,
          hash_proof = EXCLUDED.hash_proof,
          block_height = EXCLUDED.block_height,
          prev_hash = EXCLUDED.prev_hash,
          sync_status = 'SYNCED'
      `, [
        sanitized.id, sanitized.document_type, sanitized.doc_code, sanitized.country_code, sanitized.country_name, sanitized.presenter_name,
        sanitized.risk_score, sanitized.risk_verdict, sanitized.checksum_status, sanitized.findings, sanitized.timestamp, sanitized.local_time,
        sanitized.lane, sanitized.officer, sanitized.officer_uid, hashProof, fullHash, `#${blockHeight}`, sanitized.flag_reason || null,
        sanitized.mrz_string || null, sanitized.mrz_line2 || null, sanitized.doc_number || null, sanitized.dob || null, sanitized.expiry_visual || null, sanitized.expiry_mrz || null,
        sanitized.face_match_rate || null, sanitized.ela_anomaly_rate || null, sanitized.remote_station_id || null, prevHash, 'SYNCED',
        sanitized.checkpoint_id || null, sanitized.analysis ? JSON.stringify(sanitized.analysis) : null,
        sanitized.doc_number_hash || null, sanitized.provenance_hash || null, sanitized.image_fingerprint || null
      ]);

      await client.query('COMMIT');

      const enriched = { ...sanitized, full_hash: fullHash, hash_proof: hashProof, block_height: `#${blockHeight}`, sync_status: 'SYNCED' };
      const existingIdx = inMemoryScans.findIndex(s => s.id === sanitized.id);
      if (existingIdx >= 0) inMemoryScans[existingIdx] = enriched;
      else inMemoryScans.unshift(enriched);

      return enriched;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to insert scan into Neon:', err);
    return { ...sanitized, sync_status: 'QUEUED_LOCAL' };
  }
}

export async function fetchScanById(id: string): Promise<DbScanRecord | null> {
  const local = () => inMemoryScans.find(s => s.id === id) || null;
  const pool = getNeonPool();
  if (!pool) return local();
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM pehchaan_scans WHERE id = $1', [id]);
      return res.rows[0] || local();
    } finally {
      client.release();
    }
  } catch {
    return local();
  }
}

export async function syncBatchScans(scans: DbScanRecord[]): Promise<{ syncedCount: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  for (const scan of scans) {
    try {
      await insertScan(scan);
      synced++;
    } catch {
      errors++;
    }
  }

  return { syncedCount: synced, errors };
}

export async function fetchAuditLogsForTarget(targetId: string): Promise<(DbAuditLog & { hmac_signature?: string })[]> {
  const local = () => inMemoryAuditLogs.filter((l) => l.target_id === targetId);
  const pool = getNeonPool();
  if (!pool) return local();
  try {
    if (!schemaInitialized) await initNeonSchema();
    const res = await pool.query(
      'SELECT * FROM pehchaan_audit_logs WHERE target_id = $1 ORDER BY created_at ASC',
      [targetId],
    );
    return res.rows;
  } catch {
    return local();
  }
}

export async function fetchAllAuditLogs(): Promise<DbAuditLog[]> {
  const pool = getNeonPool();
  if (!pool) {
    return inMemoryAuditLogs;
  }

  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT * FROM pehchaan_audit_logs ORDER BY created_at DESC LIMIT 50
      `);
      if (res.rows.length === 0) {
        return inMemoryAuditLogs;
      }
      return res.rows;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('Neon audit query failed, using in-memory audit logs fallback:', err);
    return inMemoryAuditLogs;
  }
}

export async function insertAuditLog(log: DbAuditLog): Promise<DbAuditLog> {
  const createdAt = new Date().toISOString();
  const hmac = signAuditLog({
    action: log.action,
    officer: log.officer,
    officer_uid: log.officer_uid,
    target_id: log.target_id,
    details: log.details,
    created_at: createdAt,
  });

  const newLog = { ...log, id: inMemoryAuditLogs.length + 1, created_at: createdAt, hmac_signature: hmac } as DbAuditLog & { hmac_signature: string };
  inMemoryAuditLogs.unshift(newLog);

  const pool = getNeonPool();
  if (!pool) {
    return newLog;
  }

  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query(`
        INSERT INTO pehchaan_audit_logs (
          action, officer, officer_uid, target_id, remote_station, details, hash_proof, hmac_signature, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        log.action, log.officer, log.officer_uid, log.target_id, log.remote_station || null,
        log.details, log.hash_proof, hmac, createdAt
      ]);
      return res.rows[0];
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to insert audit log into Neon:', err);
    return newLog;
  }
}

export async function verifyChainIntegrity(): Promise<{
  valid: boolean;
  totalBlocks: number;
  genesisHash: string;
  latestHash: string;
  latestBlock: number;
  brokenAt?: number;
  error?: string;
}> {
  const pool = getNeonPool();
  if (!pool) {
    return { valid: false, totalBlocks: 0, genesisHash: GENESIS_HASH, latestHash: '', latestBlock: 0, error: 'Database not connected' };
  }

  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const res = await client.query(
        'SELECT id, document_type, presenter_name, risk_score, risk_verdict, timestamp, officer_uid, doc_number, provenance_hash, full_hash, prev_hash, block_height FROM pehchaan_scans ORDER BY created_at ASC'
      );
      const rows = res.rows;
      if (rows.length === 0) {
        return { valid: true, totalBlocks: 0, genesisHash: GENESIS_HASH, latestHash: GENESIS_HASH, latestBlock: 0 };
      }

      let expectedPrev = GENESIS_HASH;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.prev_hash && row.prev_hash !== expectedPrev) {
          const blockNum = parseInt(String(row.block_height).replace('#', ''), 10);
          return {
            valid: false, totalBlocks: rows.length, genesisHash: GENESIS_HASH,
            latestHash: rows[rows.length - 1].full_hash, latestBlock: rows.length,
            brokenAt: blockNum, error: `Chain broken at block #${blockNum}: expected prev_hash ${expectedPrev.slice(0, 8)}... but found ${(row.prev_hash || '').slice(0, 8)}...`,
          };
        }

        const recomputed = computeScanHash(expectedPrev, {
          id: row.id, document_type: row.document_type, presenter_name: row.presenter_name,
          risk_score: row.risk_score, risk_verdict: row.risk_verdict, timestamp: row.timestamp,
          officer_uid: row.officer_uid, doc_number: row.doc_number, provenance_hash: row.provenance_hash,
        });

        if (row.full_hash !== recomputed) {
          const blockNum = parseInt(String(row.block_height).replace('#', ''), 10);
          return {
            valid: false, totalBlocks: rows.length, genesisHash: GENESIS_HASH,
            latestHash: rows[rows.length - 1].full_hash, latestBlock: rows.length,
            brokenAt: blockNum, error: `Hash mismatch at block #${blockNum}: stored ${row.full_hash.slice(0, 8)}... != recomputed ${recomputed.slice(0, 8)}...`,
          };
        }

        expectedPrev = row.full_hash;
      }

      const lastBlock = parseInt(String(rows[rows.length - 1].block_height).replace('#', ''), 10);
      return {
        valid: true, totalBlocks: rows.length, genesisHash: GENESIS_HASH,
        latestHash: rows[rows.length - 1].full_hash, latestBlock: lastBlock,
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return { valid: false, totalBlocks: 0, genesisHash: GENESIS_HASH, latestHash: '', latestBlock: 0, error: err?.message };
  }
}

// ---- Reference Data (data.gov.in datasets) ----

export interface RefDataset {
  id: string;
  name: string;
  source: string;
  category: string;
  status: string;
  record_count: number;
  last_ingested?: string;
}

export async function fetchRefDatasets(category?: string): Promise<RefDataset[]> {
  const pool = getNeonPool();
  if (!pool) return [];
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM pehchaan_ref_datasets';
      const params: any[] = [];
      if (category) {
        query += ' WHERE category = $1';
        params.push(category);
      }
      query += ' ORDER BY id';
      const res = await client.query(query, params);
      return res.rows;
    } finally {
      client.release();
    }
  } catch {
    return [];
  }
}

export async function upsertRefDataset(ds: RefDataset): Promise<void> {
  const pool = getNeonPool();
  if (!pool) return;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO pehchaan_ref_datasets (id, name, source, category, status, record_count, last_ingested)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, source = EXCLUDED.source, category = EXCLUDED.category,
          status = EXCLUDED.status, record_count = EXCLUDED.record_count, last_ingested = NOW()
      `, [ds.id, ds.name, ds.source, ds.category, ds.status, ds.record_count]);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to upsert reference dataset:', err);
  }
}

export async function seedRefDatasets(catalog: RefDataset[]): Promise<number> {
  const pool = getNeonPool();
  if (!pool) return 0;
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    let count = 0;
    try {
      for (const ds of catalog) {
        await client.query(`
          INSERT INTO pehchaan_ref_datasets (id, name, source, category, status, record_count)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `, [ds.id, ds.name, ds.source, ds.category, ds.status, ds.record_count || 0]);
        count++;
      }
    } finally {
      client.release();
    }
    return count;
  } catch (err) {
    console.error('Failed to seed reference datasets:', err);
    return 0;
  }
}

export async function fetchRefDatasetStats(): Promise<{
  total: number;
  seeded: number;
  pending: number;
  categories: Record<string, number>;
}> {
  const pool = getNeonPool();
  if (!pool) return { total: 0, seeded: 0, pending: 0, categories: {} };
  try {
    if (!schemaInitialized) await initNeonSchema();
    const client = await pool.connect();
    try {
      const totalRes = await client.query('SELECT COUNT(*) FROM pehchaan_ref_datasets');
      const seededRes = await client.query("SELECT COUNT(*) FROM pehchaan_ref_datasets WHERE status IN ('seeded', 'ingested')");
      const pendingRes = await client.query("SELECT COUNT(*) FROM pehchaan_ref_datasets WHERE status = 'pending'");
      const catRes = await client.query('SELECT category, COUNT(*)::int as count FROM pehchaan_ref_datasets GROUP BY category ORDER BY category');
      const categories: Record<string, number> = {};
      for (const row of catRes.rows) {
        categories[row.category] = row.count;
      }
      return {
        total: parseInt(totalRes.rows[0].count, 10),
        seeded: parseInt(seededRes.rows[0].count, 10),
        pending: parseInt(pendingRes.rows[0].count, 10),
        categories,
      };
    } finally {
      client.release();
    }
  } catch {
    return { total: 0, seeded: 0, pending: 0, categories: {} };
  }
}
