import {
  normalizeServiceBoxRoute,
  resolveServiceBoxAction,
  serviceBoxBadge,
} from "@/utils/serviceBoxAction";

const ON = { serviceEnabled: true };

describe("normalizeServiceBoxRoute", () => {
  it("accepts an in-app path", () => {
    expect(normalizeServiceBoxRoute("/wallet")).toBe("/wallet");
    expect(normalizeServiceBoxRoute("  /ride-confirm  ")).toBe("/ride-confirm");
    expect(normalizeServiceBoxRoute("/teksi-ev?step=model")).toBe("/teksi-ev?step=model");
  });

  it("rejects anything that is not an in-app path", () => {
    // A bare name is not a route.
    expect(normalizeServiceBoxRoute("wallet")).toBeUndefined();
    // External schemes leave the app; the tile is an in-app control.
    expect(normalizeServiceBoxRoute("https://example.com")).toBeUndefined();
    expect(normalizeServiceBoxRoute("javascript:alert(1)")).toBeUndefined();
    expect(normalizeServiceBoxRoute("file:///etc/passwd")).toBeUndefined();
    // Protocol-relative still leaves the app.
    expect(normalizeServiceBoxRoute("//evil.example")).toBeUndefined();
    expect(normalizeServiceBoxRoute("/ride confirm")).toBeUndefined();
  });

  it("treats blank and missing input as unset", () => {
    expect(normalizeServiceBoxRoute("")).toBeUndefined();
    expect(normalizeServiceBoxRoute("   ")).toBeUndefined();
    expect(normalizeServiceBoxRoute(undefined)).toBeUndefined();
    expect(normalizeServiceBoxRoute(null)).toBeUndefined();
  });
});

describe("resolveServiceBoxAction", () => {
  it("navigates to a configured route", () => {
    expect(resolveServiceBoxAction({ route: "/wallet" }, ON)).toEqual({
      kind: "navigate",
      route: "/wallet",
    });
  });

  it("is coming-soon with no route configured", () => {
    // This is the case every tile shipped in: no destination at all.
    expect(resolveServiceBoxAction({}, ON)).toEqual({ kind: "coming-soon" });
    expect(resolveServiceBoxAction(undefined, ON)).toEqual({ kind: "coming-soon" });
  });

  it("is coming-soon when the admin marked it so, route or not", () => {
    expect(resolveServiceBoxAction({ route: "/wallet", comingSoon: true }, ON)).toEqual({
      kind: "coming-soon",
    });
  });

  it("is coming-soon when a route is configured but unusable", () => {
    expect(resolveServiceBoxAction({ route: "https://example.com" }, ON)).toEqual({
      kind: "coming-soon",
    });
  });

  it("never navigates while the service is globally off", () => {
    expect(
      resolveServiceBoxAction({ route: "/wallet" }, { serviceEnabled: false })
    ).toEqual({ kind: "coming-soon" });
  });
});

describe("serviceBoxBadge", () => {
  it("says SOON whenever the tile cannot navigate", () => {
    expect(serviceBoxBadge({}, ON)).toBe("SOON");
    expect(serviceBoxBadge({ route: "/wallet", comingSoon: true }, ON)).toBe("SOON");
    expect(serviceBoxBadge({ route: "/wallet" }, { serviceEnabled: false })).toBe("SOON");
  });

  it("SOON wins over NEW — a tile cannot be both", () => {
    expect(serviceBoxBadge({}, { serviceEnabled: true, newBadge: true })).toBe("SOON");
  });

  it("shows NEW only on a tile that actually goes somewhere", () => {
    expect(serviceBoxBadge({ route: "/wallet" }, { serviceEnabled: true, newBadge: true })).toBe(
      "NEW"
    );
    expect(serviceBoxBadge({ route: "/wallet" }, ON)).toBeUndefined();
  });
});
