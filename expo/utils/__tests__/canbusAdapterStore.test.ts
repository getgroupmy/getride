import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CANBUS_ADAPTERS_KEY,
  CANBUS_SELECTED_ADAPTER_KEY,
  addCanbusAdapter,
  adapterTransportOptions,
  deleteCanbusAdapter,
  describeAdapter,
  findSameDevice,
  loadCanbusAdapters,
  loadSelectedAdapterId,
  markAdapterConnected,
  normalizeAdapterDraft,
  pickDefaultAdapter,
  removeAdapter,
  upsertAdapter,
  type SavedCanAdapter,
} from "@/utils/canbusAdapterStore";

function adapter(over: Partial<SavedCanAdapter> = {}): SavedCanAdapter {
  return {
    id: "a1",
    name: "Reader",
    transport: "wifi",
    host: "192.168.0.10",
    port: 35000,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastConnectedAt: null,
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("normalizeAdapterDraft", () => {
  it("defaults a Wi-Fi reader to the standard ELM327 soft-AP endpoint", () => {
    const res = normalizeAdapterDraft({ transport: "wifi" });
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({
      transport: "wifi",
      host: "192.168.0.10",
      port: 35000,
    });
    expect(res.value?.name).toBe("Wi-Fi OBD-II reader");
  });

  it("keeps a custom host/port and trims the name", () => {
    const res = normalizeAdapterDraft({
      name: "  Vgate  ",
      transport: "wifi",
      host: " 192.168.1.5 ",
      port: "35001",
    });
    expect(res.value).toMatchObject({
      name: "Vgate",
      host: "192.168.1.5",
      port: 35001,
    });
  });

  it("rejects a malformed host", () => {
    const res = normalizeAdapterDraft({ transport: "wifi", host: "192.168.0.10:35000" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid IP address or hostname/i);
  });

  it("rejects out-of-range and non-numeric ports", () => {
    expect(normalizeAdapterDraft({ transport: "wifi", port: "0" }).ok).toBe(false);
    expect(normalizeAdapterDraft({ transport: "wifi", port: "70000" }).ok).toBe(false);
    expect(normalizeAdapterDraft({ transport: "wifi", port: "abc" }).ok).toBe(false);
    expect(normalizeAdapterDraft({ transport: "wifi", port: "35000" }).ok).toBe(true);
  });

  it("does not require an address for scan-discovered transports", () => {
    const ble = normalizeAdapterDraft({ transport: "bluetooth" });
    expect(ble.ok).toBe(true);
    expect(ble.value).toEqual({
      name: "Bluetooth OBD-II reader",
      transport: "bluetooth",
      lastConnectedAt: null,
    });

    const usb = normalizeAdapterDraft({ name: "OTG dongle", transport: "usb" });
    expect(usb.value).toMatchObject({ name: "OTG dongle", transport: "usb" });
    expect(usb.value).not.toHaveProperty("host");
  });

  it("rejects an unknown transport and an over-long name", () => {
    expect(normalizeAdapterDraft({ transport: "serial" as never }).ok).toBe(false);
    expect(normalizeAdapterDraft({ transport: "wifi", name: "x".repeat(61) }).ok).toBe(false);
  });
});

describe("describeAdapter", () => {
  it("shows the endpoint for Wi-Fi and the discovery mode otherwise", () => {
    expect(describeAdapter(adapter())).toBe("Wi-Fi · 192.168.0.10:35000");
    expect(describeAdapter(adapter({ transport: "bluetooth", host: undefined, port: undefined })))
      .toBe("Bluetooth · discovered by scan");
  });
});

describe("upsertAdapter", () => {
  it("appends a reader on a different Wi-Fi endpoint", () => {
    const list = [adapter()];
    const next = upsertAdapter(list, adapter({ id: "a2", host: "192.168.1.5" }));
    expect(next).toHaveLength(2);
  });

  it("replaces the entry for the same Wi-Fi endpoint, keeping its id", () => {
    const list = [adapter({ lastConnectedAt: 5 })];
    const next = upsertAdapter(list, adapter({ id: "a2", name: "Renamed" }));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "a1",
      name: "Renamed",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("treats scan-discovered transports as one reader per transport", () => {
    const ble = adapter({ id: "b1", transport: "bluetooth", host: undefined, port: undefined });
    const next = upsertAdapter([ble], { ...ble, id: "b2", name: "Other BLE" });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "b1", name: "Other BLE" });
  });

  it("findSameDevice reports the colliding entry", () => {
    const list = [adapter()];
    expect(findSameDevice(list, adapter({ id: "zz" }))?.id).toBe("a1");
    expect(findSameDevice(list, adapter({ id: "zz", host: "10.0.0.1" }))).toBeNull();
  });
});

describe("removeAdapter / pickDefaultAdapter", () => {
  it("removes by id", () => {
    expect(removeAdapter([adapter(), adapter({ id: "a2" })], "a1")).toEqual([
      adapter({ id: "a2" }),
    ]);
  });

  it("prefers the explicit selection", () => {
    const list = [adapter(), adapter({ id: "a2", host: "10.0.0.1" })];
    expect(pickDefaultAdapter(list, "a2")?.id).toBe("a2");
  });

  it("falls back to the most recently connected when the selection is gone", () => {
    const list = [
      adapter({ id: "a1", lastConnectedAt: 100 }),
      adapter({ id: "a2", host: "10.0.0.1", lastConnectedAt: 900 }),
    ];
    expect(pickDefaultAdapter(list, "missing")?.id).toBe("a2");
  });

  it("falls back to the first entry and to null on an empty list", () => {
    expect(pickDefaultAdapter([adapter(), adapter({ id: "a2", host: "10.0.0.1" })])?.id).toBe("a1");
    expect(pickDefaultAdapter([], "a1")).toBeNull();
  });
});

describe("adapterTransportOptions", () => {
  it("passes the endpoint through for Wi-Fi only", () => {
    expect(adapterTransportOptions(adapter())).toEqual({
      host: "192.168.0.10",
      port: 35000,
    });
    expect(adapterTransportOptions(adapter({ transport: "bluetooth" }))).toBeUndefined();
    expect(adapterTransportOptions(null)).toBeUndefined();
  });
});

describe("persistence", () => {
  it("adds a reader, persists it, and selects it", async () => {
    const res = await addCanbusAdapter({ name: "Vgate", transport: "bluetooth" });
    expect(res.error).toBeUndefined();
    expect(res.adapters).toHaveLength(1);

    const stored = await loadCanbusAdapters();
    expect(stored[0]).toMatchObject({ name: "Vgate", transport: "bluetooth" });
    expect(await loadSelectedAdapterId()).toBe(stored[0].id);
  });

  it("does not persist an invalid draft", async () => {
    const res = await addCanbusAdapter({ transport: "wifi", port: "-1" });
    expect(res.error).toBeTruthy();
    expect(res.adapter).toBeUndefined();
    expect(await loadCanbusAdapters()).toEqual([]);
  });

  it("re-adding the same dongle updates it instead of duplicating", async () => {
    await addCanbusAdapter({ name: "First", transport: "wifi", host: "10.0.0.1" });
    const second = await addCanbusAdapter({ name: "Second", transport: "wifi", host: "10.0.0.1" });
    expect(second.adapters).toHaveLength(1);
    expect(second.adapter).toMatchObject({ name: "Second" });
    expect(await loadSelectedAdapterId()).toBe(second.adapter?.id);
  });

  it("deleting the selected reader moves the selection on", async () => {
    const first = await addCanbusAdapter({ transport: "wifi", host: "10.0.0.1" });
    const second = await addCanbusAdapter({ transport: "wifi", host: "10.0.0.2" });
    expect(await loadSelectedAdapterId()).toBe(second.adapter?.id);

    const left = await deleteCanbusAdapter(second.adapter!.id);
    expect(left).toHaveLength(1);
    expect(await loadSelectedAdapterId()).toBe(first.adapter?.id);

    await deleteCanbusAdapter(first.adapter!.id);
    expect(await loadCanbusAdapters()).toEqual([]);
    expect(await loadSelectedAdapterId()).toBeNull();
  });

  it("stamps the last successful link", async () => {
    const added = await addCanbusAdapter({ transport: "bluetooth" });
    const list = await markAdapterConnected(added.adapter!.id);
    expect(typeof list[0].lastConnectedAt).toBe("number");
  });

  it("survives corrupt stored JSON", async () => {
    await AsyncStorage.setItem(CANBUS_ADAPTERS_KEY, "{not json");
    expect(await loadCanbusAdapters()).toEqual([]);
    await AsyncStorage.setItem(CANBUS_ADAPTERS_KEY, JSON.stringify({ nope: true }));
    expect(await loadCanbusAdapters()).toEqual([]);
    await AsyncStorage.setItem(CANBUS_ADAPTERS_KEY, JSON.stringify([{ junk: 1 }, adapter()]));
    expect(await loadCanbusAdapters()).toEqual([adapter()]);
  });

  it("clears the selection key when nothing is selected", async () => {
    await AsyncStorage.setItem(CANBUS_SELECTED_ADAPTER_KEY, "a1");
    await deleteCanbusAdapter("a1");
    expect(await AsyncStorage.getItem(CANBUS_SELECTED_ADAPTER_KEY)).toBeNull();
  });
});
