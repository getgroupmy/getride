import {
  motionDuration,
  motionSpring,
  resolveMotion,
  type MotionKind,
} from "@/utils/reducedMotion";

const KINDS: MotionKind[] = ["decorative", "transition", "essential"];

describe("resolveMotion", () => {
  it("changes nothing when reduced motion is off", () => {
    for (const kind of KINDS) {
      expect([kind, resolveMotion(kind, false)]).toEqual([kind, { run: true, snap: false }]);
    }
  });

  it("drops decorative motion entirely", () => {
    expect(resolveMotion("decorative", true)).toEqual({ run: false, snap: true });
  });

  it("keeps transitions running, but without the travel", () => {
    // A transition that did not run would leave the sheet closed forever.
    expect(resolveMotion("transition", true)).toEqual({ run: true, snap: true });
  });

  it("leaves essential motion alone", () => {
    // A spinner that stops tells the user the app has hung.
    expect(resolveMotion("essential", true)).toEqual({ run: true, snap: false });
  });
});

describe("motionDuration", () => {
  it("passes the duration through when motion is not reduced", () => {
    for (const kind of KINDS) {
      expect([kind, motionDuration(350, kind, false)]).toEqual([kind, 350]);
    }
  });

  it("zeroes only the kinds that snap", () => {
    expect(motionDuration(350, "transition", true)).toBe(0);
    expect(motionDuration(350, "essential", true)).toBe(350);
    expect(motionDuration(350, "decorative", true)).toBe(0);
  });
});

describe("motionSpring", () => {
  const config = { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 };

  it("returns the config untouched when motion is not reduced", () => {
    expect(motionSpring(config, "transition", false)).toBe(config);
    expect(motionSpring(config, "essential", true)).toBe(config);
  });

  it("clamps a snapped spring and drops the caller's tuning", () => {
    const out = motionSpring(config, "transition", true);
    expect(out).toEqual({
      toValue: 0,
      useNativeDriver: true,
      speed: 100,
      bounciness: 0,
      overshootClamping: true,
    });
  });

  it("drops every competing tuning pair Animated accepts", () => {
    // Animated throws if both tension/friction and speed/bounciness are given.
    const out = motionSpring(
      { toValue: 1, stiffness: 200, damping: 20, mass: 2, velocity: 3, useNativeDriver: false },
      "transition",
      true
    );
    expect(Object.keys(out).sort()).toEqual(
      ["bounciness", "overshootClamping", "speed", "toValue", "useNativeDriver"].sort()
    );
  });

  it("does not mutate the config it was given", () => {
    const original = { ...config };
    motionSpring(config, "transition", true);
    expect(config).toEqual(original);
  });
});
