import {
  isLandscapeSize,
  resolveOrientationGate,
  rotateNoticeAction,
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

describe("resolveOrientationGate", () => {
  it("lets the screen draw in a landscape viewport, whatever the lock said", () => {
    const states: OrientationLockState[] = ["pending", "locked", "unsupported"];
    for (const state of states) {
      expect(resolveOrientationGate(state, 844, 390)).toBe("ready");
    }
  });

  it("draws neither the screen nor the notice while the pin is pending", () => {
    // The device may be mid-turn: the console would be laid out for the wrong
    // shape and the notice would flash for a frame.
    expect(resolveOrientationGate("pending", 390, 844)).toBe("waiting");
  });

  it("asks for a rotate instead of drawing when the pin was refused", () => {
    expect(resolveOrientationGate("unsupported", 390, 844)).toBe("rotate");
  });

  it("asks for a rotate when the pin was accepted but the glass stayed portrait", () => {
    expect(resolveOrientationGate("locked", 390, 844)).toBe("rotate");
  });

  it("never lets the screen draw in portrait", () => {
    const states: OrientationLockState[] = ["pending", "locked", "unsupported"];
    for (const state of states) {
      expect(resolveOrientationGate(state, 390, 844)).not.toBe("ready");
    }
  });

  it("refuses to draw a viewport it cannot measure", () => {
    // Not landscape unless proven landscape — a squeezed console is worse than
    // a moment of nothing.
    expect(resolveOrientationGate("locked", NaN, NaN)).toBe("rotate");
    expect(resolveOrientationGate("pending", NaN, NaN)).toBe("waiting");
  });

  it("re-gates on a return to portrait, exactly as on first entry", () => {
    // Coming back from another page restarts the lock at `pending`; the device
    // having rotated away in the meantime must land back on the notice.
    expect(resolveOrientationGate("pending", 390, 844)).toBe("waiting");
    expect(resolveOrientationGate("locked", 390, 844)).toBe("rotate");
    expect(resolveOrientationGate("locked", 844, 390)).toBe("ready");
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

describe("rotateNoticeAction", () => {
  it("forces the rotation when the platform has a lock to ask again", () => {
    // `locked` is the interesting one: the pin was accepted and the glass
    // stayed portrait, which is exactly the case a second ask can fix.
    expect(rotateNoticeAction("locked")).toBe("force");
  });

  it("offers a way out instead when there is no lock to ask", () => {
    // Web, or a binary with no native module: the answer is cached, so a
    // Force Rotate key there would be a button that can never work.
    expect(rotateNoticeAction("unsupported")).toBe("leave");
  });

  it("does not offer to leave a screen that is still settling", () => {
    expect(rotateNoticeAction("pending")).toBe("force");
  });
});

describe("rotateNoticeCopy", () => {
  it("points at the device's own rotation lock when the app lock was accepted", () => {
    const copy = rotateNoticeCopy("locked");
    expect(copy.title).toMatch(/sideways/i);
    expect(copy.body).toMatch(/rotation lock/i);
  });

  it("names the key it is shown with, so the copy matches the button", () => {
    expect(rotateNoticeCopy("locked").body).toMatch(/force rotate/i);
    // …and never on the state whose key is a way out rather than a retry.
    expect(rotateNoticeCopy("unsupported").body).not.toMatch(/force rotate/i);
  });

  it("says the build cannot rotate for them when the lock is unavailable", () => {
    const copy = rotateNoticeCopy("unsupported");
    expect(copy.body).toMatch(/cannot rotate the screen for you/i);
    expect(copy.body).not.toMatch(/rotation lock/i);
  });
});
