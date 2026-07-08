import { uuidv4 } from "@/utils/supabase";

describe("uuidv4", () => {
  const V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("produces RFC-4122 version-4 formatted ids", () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv4()).toMatch(V4_PATTERN);
    }
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => uuidv4()));
    expect(ids.size).toBe(500);
  });
});
