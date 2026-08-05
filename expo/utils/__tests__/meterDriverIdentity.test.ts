import {
  PERMIT_STOCK_PHOTO,
  resolveMeterDriver,
  UNKNOWN_DRIVER_NAME,
} from "@/utils/meterDriverIdentity";

const PERMIT = {
  name: "AHMAD BIN ISMAIL",
  permitNumber: "TPD-889201",
  vehiclePlate: "WXY 4412",
  photoUri: "https://cdn.example.com/permit/portrait.jpg",
};

const ACCOUNT = {
  profileName: "Ahmad Ismail",
  profileAvatar: "https://cdn.example.com/avatar.png",
};

describe("resolveMeterDriver", () => {
  it("uses the params the permit screen handed over", () => {
    const id = resolveMeterDriver(
      {
        driver: "AHMAD BIN ISMAIL",
        license: "TPD-889201",
        photo: "https://cdn.example.com/permit/portrait.jpg",
        plate: "WXY 4412",
      },
      null,
      ACCOUNT,
    );
    expect(id).toEqual({
      name: "AHMAD BIN ISMAIL",
      license: "TPD-889201",
      photo: "https://cdn.example.com/permit/portrait.jpg",
      plate: "WXY 4412",
    });
  });

  it("falls back to the loaded permit on a startup launch, which carries no params", () => {
    // The launch buffer pushes /meter-digital bare. Same driver, same card.
    const id = resolveMeterDriver({}, PERMIT, ACCOUNT);
    expect(id).toEqual({
      name: "AHMAD BIN ISMAIL",
      license: "TPD-889201",
      photo: "https://cdn.example.com/permit/portrait.jpg",
      plate: "WXY 4412",
    });
  });

  it("keeps the params while the permit is still loading", () => {
    const id = resolveMeterDriver({ driver: "AHMAD BIN ISMAIL" }, null, ACCOUNT);
    expect(id.name).toBe("AHMAD BIN ISMAIL");
  });

  it("fills each field on its own, so a partial permit still helps", () => {
    // The permit portrait is the one thing the route cannot carry: a cropped
    // one is a data URL, so the permit screen only passes hosted photos.
    const id = resolveMeterDriver(
      { driver: "AHMAD BIN ISMAIL", license: "TPD-889201", plate: "WXY 4412" },
      { ...PERMIT, photoUri: "data:image/jpeg;base64,AAAA" },
      ACCOUNT,
    );
    expect(id.photo).toBe("data:image/jpeg;base64,AAAA");
    expect(id.license).toBe("TPD-889201");
  });

  it("uppercases whatever it ends up printing", () => {
    const id = resolveMeterDriver({}, null, ACCOUNT);
    expect(id.name).toBe("AHMAD ISMAIL");
  });

  it("never prints the placeholder dash as a name, licence or plate", () => {
    const id = resolveMeterDriver(
      { driver: "—", license: "—", plate: "—" },
      { name: "—", permitNumber: "—", vehiclePlate: "—", photoUri: "—" },
      ACCOUNT,
    );
    expect(id.name).toBe("AHMAD ISMAIL");
    expect(id.license).toBeNull();
    expect(id.plate).toBeNull();
    expect(id.photo).toBe(ACCOUNT.profileAvatar);
  });

  it("never shows the stock portrait as the driver on hire", () => {
    const id = resolveMeterDriver({}, { ...PERMIT, photoUri: PERMIT_STOCK_PHOTO }, ACCOUNT);
    expect(id.photo).toBe(ACCOUNT.profileAvatar);
  });

  it("draws the empty glyph rather than a stranger when there is no real photo", () => {
    const id = resolveMeterDriver(
      { photo: PERMIT_STOCK_PHOTO },
      { ...PERMIT, photoUri: PERMIT_STOCK_PHOTO },
      { profileName: "Ahmad Ismail", profileAvatar: null },
    );
    expect(id.photo).toBeNull();
  });

  it("degrades to a printable name when nothing is known at all", () => {
    const id = resolveMeterDriver(null, null, null);
    expect(id).toEqual({
      name: UNKNOWN_DRIVER_NAME,
      license: null,
      photo: null,
      plate: null,
    });
  });

  it("ignores blank and whitespace-only values", () => {
    const id = resolveMeterDriver(
      { driver: "   ", license: "", plate: "  " },
      PERMIT,
      ACCOUNT,
    );
    expect(id.name).toBe("AHMAD BIN ISMAIL");
    expect(id.license).toBe("TPD-889201");
    expect(id.plate).toBe("WXY 4412");
  });

  it("trims what it prints", () => {
    const id = resolveMeterDriver({ driver: "  ahmad  ", license: " TPD-1 " }, null, ACCOUNT);
    expect(id.name).toBe("AHMAD");
    expect(id.license).toBe("TPD-1");
  });
});
