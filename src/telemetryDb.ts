// Postgres persistence for the telemetry store.
//
// The file-backed store (.sentinel-lifeops/telemetry.json) lives on Render's ephemeral disk and is
// wiped on every spin-down / redeploy, so CBT Sentinel's scheduled scans usually found an empty
// store. This layer write-throughs every ingested log to Postgres and lets the server re-hydrate
// on boot. The file store stays authoritative for the in-memory cap; Postgres is an additive,
// unbounded archive keyed by log id (upsert-only, nothing is ever deleted here — telemetry-positive).
//
// DATABASE_URL is read lazily at first use, NOT at import time: server.ts runs dotenv.config()
// after its imports execute, so an import-time read would always see an empty env in local dev.
// If DATABASE_URL is unset, every function is a no-op and the server runs file-only as before.
import pg from "pg";

const { Pool } = pg;

// Structural minimum: anything with an id (and optional capture time) round-trips as jsonb.
export interface TelemetryDbRecord {
  id: string;
  capturedAtEpochMillis?: number;
}

let pool: pg.Pool | null = null;
let poolInitialized = false;

// Shared by tasksDb.ts — one pool per process regardless of how many stores use it.
export function getPool(): pg.Pool | null {
  if (!poolInitialized) {
    poolInitialized = true;
    const connectionString = process.env.DATABASE_URL?.trim();
    if (connectionString) {
      // Render Postgres terminates SSL with a cert the default verifier rejects, so relax
      // verification (the connection string itself is the secret). connectionTimeoutMillis keeps
      // a dead DB from hanging boot.
      pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
    }
  }
  return pool;
}

export function isTelemetryDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function ensureTelemetrySchema(): Promise<void> {
  const db = getPool();
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS lifeops_telemetry (
      id text PRIMARY KEY,
      captured_at_epoch_millis bigint NOT NULL DEFAULT 0,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS lifeops_telemetry_captured_idx
      ON lifeops_telemetry (captured_at_epoch_millis DESC);
  `);
}

export async function saveTelemetryLogsToDb(logs: TelemetryDbRecord[]): Promise<void> {
  const db = getPool();
  if (!db || logs.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  logs.forEach((log, i) => {
    values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
    params.push(log.id, log.capturedAtEpochMillis ?? 0, JSON.stringify(log));
  });
  await db.query(
    `INSERT INTO lifeops_telemetry (id, captured_at_epoch_millis, data)
     VALUES ${values.join(", ")}
     ON CONFLICT (id) DO UPDATE
       SET captured_at_epoch_millis = EXCLUDED.captured_at_epoch_millis,
           data = EXCLUDED.data,
           updated_at = now()`,
    params
  );
}

export async function loadTelemetryLogsFromDb(limit = 500): Promise<unknown[]> {
  const db = getPool();
  if (!db) return [];
  const result = await db.query(
    `SELECT data FROM lifeops_telemetry ORDER BY captured_at_epoch_millis DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map((row: { data: unknown }) => row.data);
}
