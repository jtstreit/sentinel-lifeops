import { z } from "zod";

/**
 * Models occasionally return one or two extra top-level candidates. Preserve the
 * valid highest-ranked prefix instead of marking the whole AI runtime unhealthy.
 * Nested schema violations still fail normally; only a root array-size overflow
 * is recoverable.
 */
export function parseBoundedAiArray(
  values: unknown[],
  schema: z.ZodType<unknown[]>,
): unknown[] {
  const first = schema.safeParse(values);
  if (first.success) return first.data;

  const rootOverflow = first.error.issues.find((issue) =>
    issue.code === "too_big" && issue.path.length === 0,
  );
  const maximum = Number((rootOverflow as { maximum?: unknown } | undefined)?.maximum);
  if (Number.isFinite(maximum) && maximum >= 0 && values.length > maximum) {
    return schema.parse(values.slice(0, maximum));
  }

  throw first.error;
}
