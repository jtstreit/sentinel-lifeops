export interface TelemetryArchiveCursor {
  capturedAtEpochMillis: number;
  id: string;
}

export interface TelemetryArchiveQuery {
  limit: number;
  after?: number;
  before?: number;
  cursor?: TelemetryArchiveCursor;
}

export interface ParsedTelemetryArchiveQuery {
  requested: boolean;
  query: TelemetryArchiveQuery;
}

export class TelemetryArchiveQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetryArchiveQueryError";
  }
}

type QueryValue = string | string[] | undefined;
type QueryRecord = Record<string, QueryValue>;

const ARCHIVE_KEYS = ["limit", "after", "before", "from", "to", "cursor"] as const;

function oneString(value: QueryValue, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new TelemetryArchiveQueryError(`${name} must be specified once`);
    return value[0];
  }
  return value;
}

function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new TelemetryArchiveQueryError(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TelemetryArchiveQueryError(`${name} must be a safe non-negative integer`);
  }
  return parsed;
}

function aliasValue(primary: string | undefined, alias: string | undefined, primaryName: string, aliasName: string) {
  if (primary !== undefined && alias !== undefined && primary !== alias) {
    throw new TelemetryArchiveQueryError(`${primaryName} conflicts with ${aliasName}`);
  }
  return primary ?? alias;
}

export function encodeTelemetryArchiveCursor(cursor: TelemetryArchiveCursor): string {
  return Buffer.from(JSON.stringify([cursor.capturedAtEpochMillis, cursor.id]), "utf8").toString("base64url");
}

export function decodeTelemetryArchiveCursor(value: string): TelemetryArchiveCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("shape");
    const capturedAtEpochMillis = Number(parsed[0]);
    const id = String(parsed[1] ?? "");
    if (!Number.isSafeInteger(capturedAtEpochMillis) || capturedAtEpochMillis < 0 || !id) throw new Error("value");
    return { capturedAtEpochMillis, id };
  } catch {
    throw new TelemetryArchiveQueryError("cursor is invalid");
  }
}

export function parseTelemetryArchiveQuery(raw: QueryRecord): ParsedTelemetryArchiveQuery {
  const requested = ARCHIVE_KEYS.some((key) => raw[key] !== undefined);
  if (!requested) return { requested: false, query: { limit: 500 } };

  const rawLimit = oneString(raw.limit, "limit");
  const limit = rawLimit === undefined ? 500 : parseInteger(rawLimit, "limit")!;
  if (limit < 1 || limit > 500) throw new TelemetryArchiveQueryError("limit must be between 1 and 500");

  const rawAfter = aliasValue(
    oneString(raw.after, "after"),
    oneString(raw.from, "from"),
    "after",
    "from",
  );
  const rawBefore = aliasValue(
    oneString(raw.before, "before"),
    oneString(raw.to, "to"),
    "before",
    "to",
  );
  const after = parseInteger(rawAfter, "after");
  const before = parseInteger(rawBefore, "before");
  if (after !== undefined && before !== undefined && after >= before) {
    throw new TelemetryArchiveQueryError("after must be less than before");
  }
  const rawCursor = oneString(raw.cursor, "cursor");
  return {
    requested: true,
    query: {
      limit,
      ...(after === undefined ? {} : { after }),
      ...(before === undefined ? {} : { before }),
      ...(rawCursor === undefined ? {} : { cursor: decodeTelemetryArchiveCursor(rawCursor) }),
    },
  };
}
