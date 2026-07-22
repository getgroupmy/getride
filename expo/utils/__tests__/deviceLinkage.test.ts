import {
  accountKey,
  computeDeviceLinks,
  type SessionIdentity,
} from "@/utils/deviceLinkage";

describe("accountKey", () => {
  it("prefers the user id", () => {
    expect(accountKey({ user_id: "u1", phone: "+601" })).toBe("u1");
  });
  it("falls back to a phone-prefixed key", () => {
    expect(accountKey({ user_id: null, phone: "+601" })).toBe("phone:+601");
  });
  it("returns null for an anonymous session", () => {
    expect(accountKey({ user_id: null, phone: null })).toBeNull();
  });
});

describe("computeDeviceLinks", () => {
  it("flags two accounts that share one device", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "b", phone: null, device_id: "dev-1" },
    ];
    const links = computeDeviceLinks(sessions);
    expect(links.get("a")).toEqual({
      linkedAccounts: ["b"],
      sharedDevices: ["dev-1"],
    });
    expect(links.get("b")).toEqual({
      linkedAccounts: ["a"],
      sharedDevices: ["dev-1"],
    });
  });

  it("does not flag an account that keeps its own devices", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "a", phone: null, device_id: "dev-2" },
      { user_id: "b", phone: null, device_id: "dev-3" },
    ];
    const links = computeDeviceLinks(sessions);
    expect(links.size).toBe(0);
  });

  it("links three accounts sharing a single device to each other", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "b", phone: null, device_id: "dev-1" },
      { user_id: "c", phone: null, device_id: "dev-1" },
    ];
    const links = computeDeviceLinks(sessions);
    expect(links.get("a")?.linkedAccounts).toEqual(["b", "c"]);
    expect(links.get("b")?.linkedAccounts).toEqual(["a", "c"]);
    expect(links.get("c")?.linkedAccounts).toEqual(["a", "b"]);
  });

  it("collects multiple shared devices for the same pair", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "b", phone: null, device_id: "dev-1" },
      { user_id: "a", phone: null, device_id: "dev-2" },
      { user_id: "b", phone: null, device_id: "dev-2" },
    ];
    const links = computeDeviceLinks(sessions);
    expect(links.get("a")?.sharedDevices).toEqual(["dev-1", "dev-2"]);
    expect(links.get("a")?.linkedAccounts).toEqual(["b"]);
  });

  it("keys accounts by phone when there is no user id", () => {
    const sessions: SessionIdentity[] = [
      { user_id: null, phone: "+6011", device_id: "dev-1" },
      { user_id: null, phone: "+6022", device_id: "dev-1" },
    ];
    const links = computeDeviceLinks(sessions);
    expect(links.get("phone:+6011")?.linkedAccounts).toEqual(["phone:+6022"]);
  });

  it("ignores sessions with no device_id", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: null },
      { user_id: "b", phone: null, device_id: null },
    ];
    expect(computeDeviceLinks(sessions).size).toBe(0);
  });

  it("ignores anonymous sessions with no account", () => {
    const sessions: SessionIdentity[] = [
      { user_id: null, phone: null, device_id: "dev-1" },
      { user_id: "b", phone: null, device_id: "dev-1" },
    ];
    // Only "b" is attributable; nothing to link it to.
    expect(computeDeviceLinks(sessions).size).toBe(0);
  });

  it("never links an account to itself across many sessions", () => {
    const sessions: SessionIdentity[] = [
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "a", phone: null, device_id: "dev-1" },
      { user_id: "a", phone: null, device_id: "dev-1" },
    ];
    expect(computeDeviceLinks(sessions).size).toBe(0);
  });
});
