// Postgres persistence for the shared task list (AI-worded tasks + completion checkmarks).
//
// Mirrors telemetryDb.ts: lazy DATABASE_URL read via the shared pool, no-op when unset so
// local dev keeps working file-only. Upserts are guarded by updated_at_epoch_millis so a
// stale client can never clobber a newer completion state (newer-wins, same rule as the
// client-side merge in lifeopsRules.mergeStoredTasks).
import { getPool } from "./telemetryDb";

// Structural minimum for storage: the full task rides along as jsonb.
export interface TaskDbRecord {
  id: string;
  status: string;
  updatedAtEpochMillis: number;
  completedAtEpochMillis?: number | null;
}

export function isTasksDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function ensureTasksSchema(): Promise<void> {
  const db = getPool();
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS lifeops_tasks (
      id text PRIMARY KEY,
      status text NOT NULL DEFAULT 'open',
      completed_at_epoch_millis bigint,
      updated_at_epoch_millis bigint NOT NULL DEFAULT 0,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS lifeops_tasks_status_idx
      ON lifeops_tasks (status, updated_at_epoch_millis DESC);
  `);
}

export async function saveTasksToDb(tasks: TaskDbRecord[]): Promise<void> {
  const db = getPool();
  if (!db || tasks.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  tasks.forEach((task, i) => {
    values.push(`($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`);
    params.push(task.id, task.status, task.completedAtEpochMillis ?? null, task.updatedAtEpochMillis, JSON.stringify(task));
  });
  await db.query(
    `INSERT INTO lifeops_tasks (id, status, completed_at_epoch_millis, updated_at_epoch_millis, data)
     VALUES ${values.join(", ")}
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           completed_at_epoch_millis = EXCLUDED.completed_at_epoch_millis,
           updated_at_epoch_millis = EXCLUDED.updated_at_epoch_millis,
           data = EXCLUDED.data,
           updated_at = now()
       WHERE lifeops_tasks.updated_at_epoch_millis <= EXCLUDED.updated_at_epoch_millis`,
    params
  );
}

export async function loadTasksFromDb(limit = 200): Promise<unknown[]> {
  const db = getPool();
  if (!db) return [];
  const result = await db.query(
    `SELECT data FROM lifeops_tasks ORDER BY updated_at_epoch_millis DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map((row: { data: unknown }) => row.data);
}
