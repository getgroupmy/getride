import {
  isLandscapeSize,
  rotateNoticeCopy,
  shouldPromptRotate,
  type OrientationLockState,
} from "@/utils/orientationLock";

describe("isLandscapeSize", () => {
  it("is landscape when the viewport is wider than it is tall", () => {
    expect(isLandscapeSize(844, 390)).toBe(true);
  });

  it("is not landscape in portrait", () => {
    expect(isLandscapeSize(390, 844)).toBe(false);
  });

  it("treats an exactly square viewport as not landscape", () => {
    expect(isLandscapeSize(600, 600)).toBe(false);
  });

  it("does not claim landscape for a viewport it cannot measure", () => {
    expect(isLandscapeSize(NaN, 390)).toBe(false);
    expect(isLandscapeSize(844, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("shouldPromptRotate", () => {
  it("stays quiet while the lock is still pending, even in portrait", () => {
    // The first frame of a device that is about to rotate itself is portrait;
    // flashing the notice for it reads as a bug.
    expect(shouldPromptRotate("pending", 390, 844)).toBe(false);
  });

  it("prompts once the lock reported it could not be applied", () => {
    expect(shouldPromptRotate("unsupported", 390, 844)).toBe(true);
  });

  it("prompts when the lock was accepted but the viewport stayed portrait", () => {
    expect(shouldPromptRotate("locked", 390, 844)).toBe(true);
  });

  it("never prompts once the viewport is landscape", () => {
    const states: OrientationLockState[] = ["pending", "locked", "unsupported"];
    for (const state of states) {
      expect(shouldPromptRotate(state, 844, 390)).toBe(false);
    }
  });
});

describe("rotateNoticeCopy", () => {
  it("points at the device's own rotation lock when the app lock was accepted", () => {
    const copy = rotateNoticeCopy("locked");
    expect(copy.title).toMatch(/sideways/i);
    expect(copy.body).toMatch(/rotation lock/i);
  });

  it("says the build cannot rotate for them when the lock is unavailable", () => {
    const copy = rotateNoticeCopy("unsupported");
    expect(copy.body).toMatch(/cannot rotate the screen for you/i);
    expect(copy.body).not.toMatch(/rotation lock/i);
  });
});
