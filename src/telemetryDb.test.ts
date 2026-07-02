import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
const poolCtorMock = vi.fn(function poolCtor() {
  return { query: queryMock };
});

vi.mock("pg", () => ({ default: { Pool: poolCtorMock } }));

async function loadModule() {
  vi.resetModules();
  return import("./telemetryDb");
}

describe("telemetryDb", () => {
  beforeEach(() => {
    queryMock.mockReset();
    poolCtorMock.mockClear();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("is disabled and fully no-op when DATABASE_URL is unset", async () => {
    const db = await loadModule();
    expect(db.isTelemetryDbEnabled()).toBe(false);
    await db.ensureTelemetrySchema();
    await db.saveTelemetryLogsToDb([{ id: "a", capturedAtEpochMillis: 1 }]);
    const rows = await db.loadTelemetryLogsFromDb();
    expect(rows).toEqual([]);
    expect(poolCtorMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("reads DATABASE_URL lazily at call time, not import time", async () => {
    const db = await loadModule();
    // Set the env var only AFTER import — mirrors dotenv.config() running after imports.
    process.env.DATABASE_URL = "postgres://example";
    expect(db.isTelemetryDbEnabled()).toBe(true);
    queryMock.mockResolvedValue({ rows: [] });
    await db.ensureTelemetrySchema();
    expect(poolCtorMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS lifeops_telemetry");
  });

  it("upserts logs keyed by id with capturedAtEpochMillis and the full record as jsonb", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const db = await loadModule();
    queryMock.mockResolvedValue({ rows: [] });
    const logs = [
      { id: "log-1", capturedAtEpochMillis: 111, source: "sms", title: "t1", content: "c1" },
      { id: "log-2", source: "user_note", title: "t2", content: "c2" }
    ];
    await db.saveTelemetryLogsToDb(logs);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO lifeops_telemetry");
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(params).toEqual([
      "log-1", 111, JSON.stringify(logs[0]),
      "log-2", 0, JSON.stringify(logs[1])
    ]);
  });

  it("skips the query entirely for an empty batch", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const db = await loadModule();
    await db.saveTelemetryLogsToDb([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("loads newest-first rows and returns their jsonb payloads", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const db = await loadModule();
    const stored = [{ id: "log-9", source: "sms", title: "t", content: "c" }];
    queryMock.mockResolvedValue({ rows: stored.map((data) => ({ data })) });
    const rows = await db.loadTelemetryLogsFromDb(250);
    expect(rows).toEqual(stored);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("ORDER BY captured_at_epoch_millis DESC");
    expect(params).toEqual([250]);
  });
});
