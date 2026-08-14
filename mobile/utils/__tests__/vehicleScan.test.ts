import {
  decodeReading,
  groupReadings,
  scanVehicle,
  type VehicleReading,
} from "@/utils/canbus/vehicleScan";
import { PID_GROUP_ORDER } from "@/utils/canbus/pidCatalog";
import {
  IDLE_CANBUS_STATUS,
  canbusStatusEquals,
  getActiveCanbusSession,
  getCanbusLiveStatus,
  pickActiveSession,
  publishCanbusSession,
  resetCanbusSessions,
  subscribeCanbusLiveStatus,
  summarizeCanbusStates,
  type CanbusSession,
} from "@/utils/canbus/liveStatus";
import type { CanConnectionState } from "@/utils/canbus/types";

/**
 * A stub ELM327: answers the commands it has been given a reply for, and
 * "NO DATA" for everything else — exactly how a real vehicle behaves when it
 * is asked for a PID it does not implement.
 */
function fakeAdapter(replies: Record<string, string>) {
  const sent: string[] = [];
  const send = async (command: string) => {
    sent.push(command);
    const reply = replies[command];
    if (reply === undefined) return "NO DATA\r>";
    if (reply === "THROW") throw new Error("link dropped");
    return reply;
  };
  return { send, sent };
}

describe("decodeReading", () => {
  it("decodes a known PID with its label and unit", () => {
    expect(decodeReading("0C", "410C1AF8\r>")).toEqual({
      pid: "0C",
      label: "Engine speed",
      value: "1726 rpm",
      group: "engine",
      known: true,
      numeric: 1726,
    });
  });

  it("falls back to raw bytes for a PID the catalog does not know", () => {
    expect(decodeReading("C3", "41C3ABCD\r>")).toEqual({
      pid: "C3",
      label: "PID 01C3",
      value: "AB CD",
      group: "other",
      known: false,
    });
  });

  it("falls back to raw bytes when a known PID answers short", () => {
    // The catalog wants two bytes for 0C; this ECU sent one.
    const reading = decodeReading("0C", "410C1A\r>");
    expect(reading?.known).toBe(false);
    expect(reading?.value).toBe("1A");
  });

  it("returns null when the PID did not answer", () => {
    expect(decodeReading("0C", "NO DATA\r>")).toBeNull();
  });
});

describe("groupReadings", () => {
  it("orders sections and drops empty ones", () => {
    const readings: VehicleReading[] = [
      { pid: "0D", label: "Vehicle speed", value: "0 km/h", group: "vehicle", known: true },
      { pid: "0C", label: "Engine speed", value: "800 rpm", group: "engine", known: true },
    ];
    expect(groupReadings(readings, PID_GROUP_ORDER).map((s) => s.group)).toEqual([
      "engine",
      "vehicle",
    ]);
  });
});

describe("scanVehicle", () => {
  const baseReplies: Record<string, string> = {
    ATI: "ELM327 v1.5\r>",
    ATRV: "12.5V\r>",
    // Supports PIDs 01, 05, 0C, 0D and 20 (so the next range is probed too).
    "0100": "4100 88 18 00 01\r>",
    // Second range: nothing supported, and no third range.
    "0120": "4120 00 00 00 00\r>",
    "0101": "4101 83 07 21 01\r>",
    "0105": "41057B\r>",
    "010C": "410C1AF8\r>",
    "010D": "410D00\r>",
    "0900": "490054000000\r>",
    "0902": "014\r0:49020131443447\r1:5030305235354231\r2:3233343536\r>",
    "0904": "4904 41 42 43\r>",
    "0906": "4906 01 02 03 04\r>",
    "03": "4302013304 20\r>",
    "07": "4700\r>",
    "0A": "4A00\r>",
  };

  it("reads the adapter, the supported PIDs, the identity and the codes", async () => {
    const adapter = fakeAdapter(baseReplies);
    const report = await scanVehicle(adapter.send);

    expect(report.adapter).toEqual([
      { key: "firmware", label: "Adapter firmware", value: "ELM327 v1.5" },
      { key: "batteryVoltage", label: "Battery voltage (adapter)", value: "12.5V" },
    ]);
    expect(report.supportedPids).toEqual(["01", "05", "0C", "0D", "20"]);
    expect(report.monitor?.dtcCount).toBe(3);
    expect(report.vin).toBe("1D4GP00R55B123456");
    expect(report.dtcs).toEqual({ stored: ["P0133", "P0420"], pending: [], permanent: [] });
  });

  it("decodes each supported parameter and skips the structural PIDs", async () => {
    const adapter = fakeAdapter(baseReplies);
    const report = await scanVehicle(adapter.send);

    expect(report.readings.map((r) => r.pid)).toEqual(["05", "0C", "0D"]);
    expect(report.readings.map((r) => r.value)).toEqual(["83 °C", "1726 rpm", "0 km/h"]);
    // 01 is the monitor frame and 20 is the next support mask — neither is a
    // reading, so neither is requested as one.
    expect(adapter.sent).not.toContain("0101 ");
    expect(adapter.sent.filter((c) => c === "0120")).toHaveLength(1);
  });

  it("follows the support chain only while the mask says to", async () => {
    const adapter = fakeAdapter(baseReplies);
    await scanVehicle(adapter.send);
    expect(adapter.sent).toContain("0100");
    expect(adapter.sent).toContain("0120");
    expect(adapter.sent).not.toContain("0140");
  });

  it("records a supported PID that refuses to answer instead of dropping it", async () => {
    const adapter = fakeAdapter({ ...baseReplies, "010C": "NO DATA\r>" });
    const report = await scanVehicle(adapter.send);
    expect(report.unreadablePids).toEqual(["0C"]);
    expect(report.readings.map((r) => r.pid)).toEqual(["05", "0D"]);
  });

  it("survives a command that throws", async () => {
    const adapter = fakeAdapter({ ...baseReplies, "010D": "THROW" });
    const report = await scanVehicle(adapter.send);
    expect(report.unreadablePids).toEqual(["0D"]);
    expect(report.readings.map((r) => r.pid)).toEqual(["05", "0C"]);
  });

  it("asks for the VIN anyway when the mode-09 support probe fails", async () => {
    const replies = { ...baseReplies };
    delete replies["0900"];
    const adapter = fakeAdapter(replies);
    const report = await scanVehicle(adapter.send);
    expect(adapter.sent).toContain("0902");
    expect(report.vin).toBe("1D4GP00R55B123456");
  });

  it("skips a mode-09 item the vehicle says it does not implement", async () => {
    // 0x80000000 → mode 09 PID 01 only.
    const adapter = fakeAdapter({ ...baseReplies, "0900": "490080000000\r>" });
    await scanVehicle(adapter.send);
    expect(adapter.sent).not.toContain("0902");
  });

  it("reports monotonic progress that never exceeds the total", async () => {
    const adapter = fakeAdapter(baseReplies);
    const seen: { done: number; total: number }[] = [];
    await scanVehicle(adapter.send, {
      onProgress: (p) => seen.push({ done: p.done, total: p.total }),
    });
    expect(seen.length).toBeGreaterThan(0);
    let last = 0;
    for (const p of seen) {
      expect(p.done).toBeGreaterThanOrEqual(last);
      expect(p.done).toBeLessThanOrEqual(p.total);
      last = p.done;
    }
  });

  it("abandons the scan when the caller says to stop", async () => {
    const adapter = fakeAdapter(baseReplies);
    let calls = 0;
    const report = await scanVehicle(adapter.send, {
      shouldContinue: () => {
        calls += 1;
        return calls <= 3;
      },
    });
    expect(adapter.sent.length).toBeLessThan(5);
    expect(report.readings).toEqual([]);
  });

  it("starts from a clean report every time", async () => {
    const adapter = fakeAdapter(baseReplies);
    const first = await scanVehicle(adapter.send);
    const second = await scanVehicle(adapter.send);
    expect(second.adapter).toEqual(first.adapter);
    expect(second.readings).toHaveLength(first.readings.length);
  });
});

/* ------------------------------------------------------------------ */

function stateFor(overrides: Partial<CanConnectionState> = {}): CanConnectionState {
  return {
    phase: "online",
    device: { name: "OBDII", id: "1", transport: "bluetooth" },
    protocol: "ISO 15765-4 CAN (11-bit, 500 kbps)",
    bitrateKbps: 500,
    telemetry: {},
    lastUpdate: null,
    error: null,
    simulated: false,
    ...overrides,
  };
}

function sessionFor(state: CanConnectionState): CanbusSession {
  return {
    state,
    sendCommand: async () => "OK\r>",
    setPollingPaused: () => undefined,
  };
}

describe("summarizeCanbusStates", () => {
  it("reports idle when nothing has connected", () => {
    expect(summarizeCanbusStates([])).toEqual(IDLE_CANBUS_STATUS);
    expect(summarizeCanbusStates([stateFor({ phase: "connecting" })])).toEqual(
      IDLE_CANBUS_STATUS,
    );
  });

  it("reports a real link as linked", () => {
    expect(summarizeCanbusStates([stateFor()])).toEqual({
      online: true,
      simulated: false,
      linked: true,
      deviceName: "OBDII",
      transport: "bluetooth",
    });
  });

  it("never reports the simulator as a link", () => {
    const status = summarizeCanbusStates([
      stateFor({ simulated: true, device: { name: "Simulated adapter", id: "sim", transport: "bluetooth" } }),
    ]);
    expect(status).toMatchObject({ online: true, simulated: true, linked: false });
  });

  it("prefers a real link over a simulated one", () => {
    const status = summarizeCanbusStates([
      stateFor({ simulated: true, device: { name: "Simulated adapter", id: "sim", transport: "bluetooth" } }),
      stateFor({ device: { name: "Vgate iCar Pro", id: "2", transport: "wifi" } }),
    ]);
    expect(status).toMatchObject({ linked: true, deviceName: "Vgate iCar Pro", transport: "wifi" });
  });
});

describe("pickActiveSession", () => {
  it("returns nothing until a session is online", () => {
    expect(pickActiveSession([])).toBeNull();
    expect(pickActiveSession([sessionFor(stateFor({ phase: "handshaking" }))])).toBeNull();
  });

  it("prefers a real session over a simulated one", () => {
    const sim = sessionFor(stateFor({ simulated: true }));
    const real = sessionFor(stateFor());
    expect(pickActiveSession([sim, real])).toBe(real);
  });
});

describe("canbus session registry", () => {
  afterEach(() => resetCanbusSessions());

  it("publishes and withdraws a session", () => {
    publishCanbusSession("a", sessionFor(stateFor()));
    expect(getCanbusLiveStatus().linked).toBe(true);
    expect(getActiveCanbusSession()).not.toBeNull();

    publishCanbusSession("a", null);
    expect(getCanbusLiveStatus()).toEqual(IDLE_CANBUS_STATUS);
    expect(getActiveCanbusSession()).toBeNull();
  });

  it("collapses several mounted screens into one status", () => {
    publishCanbusSession("teksi", sessionFor(stateFor()));
    publishCanbusSession("meter", sessionFor(stateFor()));
    expect(getCanbusLiveStatus().linked).toBe(true);
    // One screen unmounting must not take the link down with it.
    publishCanbusSession("meter", null);
    expect(getCanbusLiveStatus().linked).toBe(true);
  });

  it("only notifies subscribers when the status actually changes", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeCanbusLiveStatus((s) => seen.push(s.linked));
    publishCanbusSession("a", sessionFor(stateFor()));
    // A telemetry tick republishes the same session with a new state object.
    publishCanbusSession("a", sessionFor(stateFor({ telemetry: { speed: 40 } })));
    expect(seen).toEqual([true]);
    unsubscribe();
    publishCanbusSession("a", null);
    expect(seen).toEqual([true]);
  });

  it("treats equal statuses as interchangeable", () => {
    expect(canbusStatusEquals(IDLE_CANBUS_STATUS, { ...IDLE_CANBUS_STATUS })).toBe(true);
    expect(
      canbusStatusEquals(IDLE_CANBUS_STATUS, { ...IDLE_CANBUS_STATUS, online: true }),
    ).toBe(false);
  });
});
