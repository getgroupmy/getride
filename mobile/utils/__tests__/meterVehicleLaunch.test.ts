import {
  describeMeterVehicle,
  resolveMeterPlate,
  resolveMeterVehicleLaunch,
  type MeterVehicleRow,
} from "@/utils/meterVehicleLaunch";

function row(
  plate: string,
  overrides: Partial<Omit<MeterVehicleRow, "vehicle">> & {
    make?: string;
    model?: string;
  } = {},
): MeterVehicleRow {
  const { make, model, ...rest } = overrides;
  return {
    vehicle: { id: `veh-${plate}`, plate, make: make ?? "Perodua", model: model ?? "Myvi" },
    inUseByMe: false,
    inUseByOther: false,
    selectable: true,
    ...rest,
  };
}

describe("resolveMeterVehicleLaunch", () => {
  it("opens on the vehicle still connected to this driver, asking nothing", () => {
    const mine = row("WXY 1234", { inUseByMe: true });
    const d = resolveMeterVehicleLaunch({
      vehicles: [row("ABC 1"), mine, row("ABC 2")],
      canRead: true,
    });
    expect(d.reason).toBe("bound");
    expect(d.vehicle).toBe(mine);
    expect(d.prompt).toBe(false);
  });

  it("puts the claimed vehicle first in the picker, then the claimable ones by plate", () => {
    const d = resolveMeterVehicleLaunch({
      vehicles: [
        row("WCC 3"),
        row("WAA 1"),
        row("WBB 2", { inUseByMe: true }),
        row("WZZ 9", { inUseByOther: true, selectable: false }),
      ],
      canRead: true,
    });
    expect(d.choices.map((c) => c.vehicle.plate)).toEqual([
      "WBB 2",
      "WAA 1",
      "WCC 3",
      "WZZ 9",
    ]);
  });

  it("asks the driver to choose when nothing is claimed, even with a single car", () => {
    const d = resolveMeterVehicleLaunch({ vehicles: [row("WXY 1234")], canRead: true });
    expect(d.reason).toBe("choose");
    expect(d.vehicle).toBeNull();
    expect(d.prompt).toBe(true);
  });

  it("never binds to a vehicle another driver is out in", () => {
    const d = resolveMeterVehicleLaunch({
      vehicles: [row("WXY 1234", { inUseByOther: true, selectable: false })],
      canRead: true,
    });
    expect(d.reason).toBe("none");
    expect(d.vehicle).toBeNull();
    expect(d.prompt).toBe(true);
  });

  it("does not bind to a session on a vehicle the app has since locked", () => {
    // Claimed, then blocked / left mid-onboarding: still "mine", no longer
    // something the app will let anyone drive.
    const d = resolveMeterVehicleLaunch({
      vehicles: [row("WXY 1234", { inUseByMe: true, selectable: false })],
      canRead: true,
    });
    expect(d.reason).toBe("none");
    expect(d.vehicle).toBeNull();
    expect(d.prompt).toBe(true);
  });

  it("asks, and says so, when the driver has no vehicle at all", () => {
    const d = resolveMeterVehicleLaunch({ vehicles: [], canRead: true });
    expect(d.reason).toBe("none");
    expect(d.prompt).toBe(true);
    expect(d.message).toContain("No vehicle is assigned");
  });

  it("asks nothing when the fleet could not be read — an empty list is not an answer", () => {
    const d = resolveMeterVehicleLaunch({ vehicles: [], canRead: false });
    expect(d.reason).toBe("unavailable");
    expect(d.prompt).toBe(false);
    expect(d.vehicle).toBeNull();
    expect(d.choices).toEqual([]);
  });
});

describe("describeMeterVehicle", () => {
  it("names the plate and the model, or whichever of them exists", () => {
    expect(describeMeterVehicle(row("WXY 1234"))).toBe("WXY 1234 · Perodua Myvi");
    expect(describeMeterVehicle(row("WXY 1234", { make: "", model: "" }))).toBe("WXY 1234");
    expect(
      describeMeterVehicle({
        vehicle: { id: "x", plate: "", make: "Proton", model: "Saga" },
        inUseByMe: false,
        inUseByOther: false,
        selectable: true,
      }),
    ).toBe("Proton Saga");
    expect(describeMeterVehicle(null)).toBe("no vehicle");
  });
});

describe("resolveMeterPlate", () => {
  it("shows the car the meter is bound to over the one on the permit", () => {
    expect(resolveMeterPlate(row("WXY 1234"), "ABC 9999")).toBe("WXY 1234");
  });

  it("falls back to the permit plate, and treats the permit's dash as nothing", () => {
    expect(resolveMeterPlate(null, "ABC 9999")).toBe("ABC 9999");
    expect(resolveMeterPlate(null, "—")).toBeNull();
    expect(resolveMeterPlate(null, null)).toBeNull();
    expect(resolveMeterPlate(row("   ", { make: "", model: "" }), "ABC 9999")).toBe(
      "ABC 9999",
    );
  });
});
