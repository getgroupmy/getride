import {
  FULLSCREEN_MODAL_PROPS,
  LANDSCAPE_FULLSCREEN_OPTIONS,
  landscapeFullscreen,
} from "@/utils/fullscreenChrome";
import { supportsLandscape } from "@/utils/modalOrientation";

describe("LANDSCAPE_FULLSCREEN_OPTIONS", () => {
  it("pins both landscape directions, never portrait", () => {
    // "landscape" is the two-sided lock: a cradle works whichever way round it
    // holds the device. "landscape_left"/"landscape_right" would each refuse
    // one of them.
    expect(LANDSCAPE_FULLSCREEN_OPTIONS.orientation).toBe("landscape");
  });

  it("takes every system bar off the glass", () => {
    // One per platform surface: iOS + Android status bar, the Android
    // navigation bar, the iOS home indicator. Losing any one of them shows as
    // "the meter looks slightly wrong on one platform" and nothing louder.
    expect(LANDSCAPE_FULLSCREEN_OPTIONS.statusBarHidden).toBe(true);
    expect(LANDSCAPE_FULLSCREEN_OPTIONS.navigationBarHidden).toBe(true);
    expect(LANDSCAPE_FULLSCREEN_OPTIONS.autoHideHomeIndicator).toBe(true);
  });
});

describe("landscapeFullscreen", () => {
  it("keeps the route's own options", () => {
    const merged = landscapeFullscreen({ animation: "slide_from_right", gestureEnabled: false });
    expect(merged.animation).toBe("slide_from_right");
    expect(merged.gestureEnabled).toBe(false);
    expect(merged.orientation).toBe("landscape");
  });

  it("works with no options of its own", () => {
    expect(landscapeFullscreen()).toEqual(LANDSCAPE_FULLSCREEN_OPTIONS);
  });

  it("does not let a route be half full-screen", () => {
    // The chrome wins over anything the route asked for: a screen that is
    // read off a windscreen mount does not get to keep the status bar.
    const merged = landscapeFullscreen({ orientation: "portrait", statusBarHidden: false });
    expect(merged.orientation).toBe("landscape");
    expect(merged.statusBarHidden).toBe(true);
  });

  it("does not mutate the shared options object", () => {
    const merged = landscapeFullscreen({ animation: "fade" });
    expect(merged).not.toBe(LANDSCAPE_FULLSCREEN_OPTIONS);
    expect(LANDSCAPE_FULLSCREEN_OPTIONS).not.toHaveProperty("animation");
  });
});

describe("FULLSCREEN_MODAL_PROPS", () => {
  it("declares landscape, which iOS raises an exception without", () => {
    expect(supportsLandscape(FULLSCREEN_MODAL_PROPS.supportedOrientations)).toBe(true);
  });

  it("draws under both Android system bars, so the console does not jump", () => {
    expect(FULLSCREEN_MODAL_PROPS.statusBarTranslucent).toBe(true);
    expect(FULLSCREEN_MODAL_PROPS.navigationBarTranslucent).toBe(true);
  });
});
