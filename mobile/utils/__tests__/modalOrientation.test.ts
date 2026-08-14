import {
  MODAL_SUPPORTED_ORIENTATIONS,
  supportsLandscape,
  type ModalOrientation,
} from "@/utils/modalOrientation";

describe("MODAL_SUPPORTED_ORIENTATIONS", () => {
  it("accepts landscape, which is what stops iOS throwing on a sideways screen", () => {
    expect(supportsLandscape(MODAL_SUPPORTED_ORIENTATIONS)).toBe(true);
  });

  it("covers every orientation the app itself allows", () => {
    expect([...MODAL_SUPPORTED_ORIENTATIONS].sort()).toEqual(
      [
        "landscape",
        "landscape-left",
        "landscape-right",
        "portrait",
        "portrait-upside-down",
      ].sort(),
    );
  });
});

describe("supportsLandscape", () => {
  it("rejects the React Native default", () => {
    // `["portrait"]` is what a <Modal> declares when the prop is omitted, and
    // it is what crashed Meter Digital's popups.
    expect(supportsLandscape(["portrait"])).toBe(false);
  });

  it("rejects an undeclared list", () => {
    expect(supportsLandscape(undefined)).toBe(false);
  });

  it("accepts a one-sided landscape declaration", () => {
    const left: ModalOrientation[] = ["portrait", "landscape-left"];
    expect(supportsLandscape(left)).toBe(true);
    expect(supportsLandscape(["landscape-right"])).toBe(true);
  });

  it("rejects portrait-only variants", () => {
    expect(supportsLandscape(["portrait", "portrait-upside-down"])).toBe(false);
  });

  it("rejects an empty declaration", () => {
    expect(supportsLandscape([])).toBe(false);
  });
});
