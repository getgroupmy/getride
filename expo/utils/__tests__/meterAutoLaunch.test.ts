import {
  hasTeksiPartnerType,
  resolveMeterAutoLaunch,
} from "@/utils/meterAutoLaunch";
import {
  DEFAULT_METER_PROFILE,
  type MeterProfile,
  type MeterSettingsLevel,
} from "@/utils/meterSettings";

function card(
  level: MeterSettingsLevel,
  overrides: Partial<MeterProfile> = {},
): MeterProfile {
  return {
    ...DEFAULT_METER_PROFILE,
    id: `${level}-card`,
    level,
    rates: { ...DEFAULT_METER_PROFILE.rates },
    panels: {
      meter: { show: true, tap: true },
      trips: { show: true, tap: true },
      printer: { show: true, tap: true },
      obd: { show: true, tap: true },
      settings: { show: true, tap: true },
    },
    ...overrides,
  };
}

describe("hasTeksiPartnerType", () => {
  it("matches whatever casing the partner row happens to carry", () => {
    expect(hasTeksiPartnerType(["TEKSI"])).toBe(true);
    expect(hasTeksiPartnerType(["Teksi"])).toBe(true);
    expect(hasTeksiPartnerType([" teksi "])).toBe(true);
    expect(hasTeksiPartnerType(["eHailing", "teksi"])).toBe(true);
  });

  it("is false for a partner who drives something else, or for no partner", () => {
    expect(hasTeksiPartnerType(["eHailing", "pHailing"])).toBe(false);
    expect(hasTeksiPartnerType([])).toBe(false);
    expect(hasTeksiPartnerType(null)).toBe(false);
    expect(hasTeksiPartnerType(undefined)).toBe(false);
  });

  it("ignores junk entries rather than throwing on them", () => {
    expect(hasTeksiPartnerType([null, undefined, 7, {}])).toBe(false);
    expect(hasTeksiPartnerType([null, "teksi"])).toBe(true);
  });
});

describe("resolveMeterAutoLaunch", () => {
  const teksi = ["teksi"];

  it("opens the meter when a TEKSI partner's card asks for it", () => {
    const d = resolveMeterAutoLaunch({
      profiles: [card("master", { autoLaunch: true })],
      partnerTypes: teksi,
    });
    expect(d.launch).toBe(true);
    expect(d.reason).toBe("launch");
    expect(d.card.level).toBe("master");
  });

  it("does nothing for an account that is not a TEKSI partner", () => {
    const profiles = [card("master", { autoLaunch: true })];
    expect(
      resolveMeterAutoLaunch({ profiles, partnerTypes: ["eHailing"] }).reason,
    ).toBe("not-teksi");
    expect(resolveMeterAutoLaunch({ profiles, partnerTypes: null }).launch).toBe(false);
  });

  it("does nothing when the card leaves the redirect off", () => {
    const d = resolveMeterAutoLaunch({
      profiles: [card("master", { autoLaunch: false })],
      partnerTypes: teksi,
    });
    expect(d.launch).toBe(false);
    expect(d.reason).toBe("card-off");
  });

  it("defaults to off with nothing configured anywhere", () => {
    const d = resolveMeterAutoLaunch({ profiles: [], partnerTypes: teksi });
    expect(d.launch).toBe(false);
    expect(d.card.level).toBe("default");
  });

  it("reads the flag off the narrowest card that matches, like the fare does", () => {
    const profiles = [
      card("master", { autoLaunch: false }),
      card("city", { autoLaunch: true, country: "Malaysia", state: "Selangor", city: "Klang" }),
    ];
    expect(
      resolveMeterAutoLaunch({
        profiles,
        partnerTypes: teksi,
        geo: { country: "Malaysia", state: "Selangor", city: "Klang" },
      }).launch,
    ).toBe(true);
    // A driver working elsewhere in the country falls back to the global card.
    expect(
      resolveMeterAutoLaunch({
        profiles,
        partnerTypes: teksi,
        geo: { country: "Malaysia", state: "Penang", city: "George Town" },
      }).launch,
    ).toBe(false);
  });

  it("lets a narrower card switch the redirect back off", () => {
    const profiles = [
      card("master", { autoLaunch: true }),
      card("city", { autoLaunch: false, country: "Malaysia", state: "Selangor", city: "Klang" }),
    ];
    const d = resolveMeterAutoLaunch({
      profiles,
      partnerTypes: teksi,
      geo: { country: "Malaysia", state: "Selangor", city: "Klang" },
    });
    expect(d.launch).toBe(false);
    expect(d.card.level).toBe("city");
  });

  it("falls back to the global card when the device has no geography yet", () => {
    const profiles = [
      card("master", { autoLaunch: true }),
      card("city", { autoLaunch: false, country: "Malaysia", state: "Selangor", city: "Klang" }),
    ];
    const d = resolveMeterAutoLaunch({ profiles, partnerTypes: teksi, geo: null });
    expect(d.launch).toBe(true);
    expect(d.card.level).toBe("master");
  });

  it("skips an inactive card rather than reading the redirect off it", () => {
    const profiles = [
      card("master", { autoLaunch: false }),
      card("city", {
        autoLaunch: true,
        active: false,
        country: "Malaysia",
        state: "Selangor",
        city: "Klang",
      }),
    ];
    const d = resolveMeterAutoLaunch({
      profiles,
      partnerTypes: teksi,
      geo: { country: "Malaysia", state: "Selangor", city: "Klang" },
    });
    expect(d.launch).toBe(false);
    expect(d.card.level).toBe("master");
  });
});
