import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBoundedAiArray } from "./aiArrayOutput";

describe("parseBoundedAiArray", () => {
  it("keeps the valid prefix when a model exceeds only the root array limit", () => {
    const schema = z.array(z.object({ id: z.number() })).max(2);
    expect(parseBoundedAiArray([{ id: 1 }, { id: 2 }, { id: 3 }], schema)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("does not hide nested validation failures", () => {
    const schema = z.array(z.object({ ids: z.array(z.string()).max(1) })).max(2);
    expect(() => parseBoundedAiArray([{ ids: ["a", "b"] }], schema)).toThrow();
  });
});
