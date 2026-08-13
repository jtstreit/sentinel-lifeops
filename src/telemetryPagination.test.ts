import { describe, expect, it } from "vitest";
import {
  decodeTelemetryArchiveCursor,
  encodeTelemetryArchiveCursor,
  parseTelemetryArchiveQuery,
  TelemetryArchiveQueryError,
} from "./telemetryPagination";

describe("telemetry archive query parsing", () => {
  it("preserves the legacy no-query path", () => {
    expect(parseTelemetryArchiveQuery({})).toEqual({ requested: false, query: { limit: 500 } });
  });

  it("parses limits, range aliases, and an opaque cursor", () => {
    const cursor = encodeTelemetryArchiveCursor({ capturedAtEpochMillis: 123, id: "same-time-b" });
    expect(decodeTelemetryArchiveCursor(cursor)).toEqual({ capturedAtEpochMillis: 123, id: "same-time-b" });
    expect(parseTelemetryArchiveQuery({ limit: "25", from: "100", to: "200", cursor })).toEqual({
      requested: true,
      query: {
        limit: 25,
        after: 100,
        before: 200,
        cursor: { capturedAtEpochMillis: 123, id: "same-time-b" },
      },
    });
  });

  it.each([
    [{ limit: "0" }, "limit"],
    [{ limit: "501" }, "limit"],
    [{ limit: "1.5" }, "limit"],
    [{ after: "200", before: "200" }, "after"],
    [{ after: "100", from: "101" }, "conflicts"],
    [{ cursor: "not-a-cursor" }, "cursor"],
    [{ limit: ["1", "2"] }, "once"],
  ])("rejects malformed query %#", (query, message) => {
    expect(() => parseTelemetryArchiveQuery(query)).toThrow(TelemetryArchiveQueryError);
    expect(() => parseTelemetryArchiveQuery(query)).toThrow(message);
  });
});
