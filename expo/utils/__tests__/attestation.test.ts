import { isAttestablePlatform, makeChallenge } from "@/utils/attestation";

describe("isAttestablePlatform", () => {
  it("is true for android and ios", () => {
    expect(isAttestablePlatform("android")).toBe(true);
    expect(isAttestablePlatform("ios")).toBe(true);
  });
  it("is false for web and anything else", () => {
    expect(isAttestablePlatform("web")).toBe(false);
    expect(isAttestablePlatform("windows")).toBe(false);
    expect(isAttestablePlatform("")).toBe(false);
  });
});

describe("makeChallenge", () => {
  it("produces a non-empty string", () => {
    expect(makeChallenge().length).toBeGreaterThan(0);
  });
  it("is unique across calls", () => {
    const a = new Set(Array.from({ length: 200 }, () => makeChallenge()));
    expect(a.size).toBe(200);
  });
});
