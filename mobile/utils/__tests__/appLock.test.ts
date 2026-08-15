import {
  isUnlocked,
  lockApp,
  markUnlocked,
  shouldRequirePin,
} from "@/utils/appLock";

beforeEach(() => {
  lockApp();
});

describe("app lock state", () => {
  it("starts locked, so a relaunch is never implicitly trusted", () => {
    expect(isUnlocked()).toBe(false);
  });

  it("records a successful unlock", () => {
    markUnlocked();
    expect(isUnlocked()).toBe(true);
  });

  it("re-locks, so a sign-out does not leave the next account unlocked", () => {
    markUnlocked();
    lockApp();
    expect(isUnlocked()).toBe(false);
  });
});

describe("shouldRequirePin", () => {
  it("holds an authenticated, PIN-protected launch that has not been unlocked", () => {
    expect(
      shouldRequirePin({ isAuthenticated: true, hasPin: true, unlocked: false })
    ).toBe(true);
  });

  it("does not ask twice in one run of the app", () => {
    expect(
      shouldRequirePin({ isAuthenticated: true, hasPin: true, unlocked: true })
    ).toBe(false);
  });

  it("never holds a signed-out launch — there is nothing to protect yet", () => {
    expect(
      shouldRequirePin({ isAuthenticated: false, hasPin: true, unlocked: false })
    ).toBe(false);
  });

  it("does not strand an account with no PIN set", () => {
    // Nothing to verify against, so holding here would leave no way forward.
    expect(
      shouldRequirePin({ isAuthenticated: true, hasPin: false, unlocked: false })
    ).toBe(false);
  });

  it("treats a signed-out, PIN-less launch as nothing to do", () => {
    expect(
      shouldRequirePin({ isAuthenticated: false, hasPin: false, unlocked: false })
    ).toBe(false);
  });
});
