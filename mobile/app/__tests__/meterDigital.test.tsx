import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";

/**
 * Meter Digital.
 *
 * The invariant worth a test is not how the console looks — it is that
 * *simulated telemetry never bills a fare*. Demo Mode is admin-gated and
 * useful, but a fare accrued from invented speed would be charged to a real
 * passenger, so the screen withholds the simulator's speed and lets the sample
 * fall through to GPS exactly as if no reader were linked.
 *
 * These assert on the sample handed to `applyMeterSample`, which is where that
 * decision actually lands.
 */

const canbusState = {
  phase: "online" as string,
  device: null,
  protocol: null,
  bitrateKbps: null,
  telemetry: { speed: 88 } as Record<string, number>,
  lastUpdate: 1_700_000_000_000,
  error: null,
  simulated: false,
};

jest.mock("@/hooks/useCanbus", () => ({
  useCanbus: () => ({
    state: canbusState,
    availability: [],
    availableTransports: [],
    savedAdapters: [],
    defaultAdapter: null,
    reloadAdapters: jest.fn(),
    connecting: false,
    connect: jest.fn(),
    connectDemo: jest.fn(),
    disconnect: jest.fn(),
    sendCommand: jest.fn(),
    setPollingPaused: jest.fn(),
  }),
}));

jest.mock("@/hooks/useLandscapeLock", () => ({ useLandscapeLock: () => {} }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn() } }));

jest.mock("expo-location", () => ({
  Accuracy: { BestForNavigation: 4, Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 3.1, longitude: 101.7, accuracy: 5, speed: 10 },
  }),
}));

// Spy on the accrual entry point without replacing the tariff arithmetic.
const mockApplySample = jest.fn();
jest.mock("@/utils/taxiMeter", () => {
  const actual = jest.requireActual("@/utils/taxiMeter");
  return {
    ...actual,
    applyMeterSample: (state: unknown, sample: unknown) => {
      mockApplySample(sample);
      return actual.applyMeterSample(state, sample);
    },
  };
});

// Imported after the mocks above so the dependency list reads in the order it
// takes effect. Babel hoists `jest.mock` regardless, so this is for the reader.
// eslint-disable-next-line import/first
import MeterDigital from "@/app/meter-digital";

/** Start the hire, so samples are actually accrued. */
async function startHire(getByLabelText: (l: string) => unknown) {
  const { fireEvent } = jest.requireActual("@testing-library/react-native");
  await act(async () => {
    fireEvent.press(getByLabelText("Start hire"));
  });
}

/**
 * Advance the console's 1 Hz clock deterministically.
 *
 * Without this the assertions race a real 1000 ms interval against waitFor's
 * default timeout, which is exactly the kind of test that passes on one machine
 * and fails on another.
 */
async function tickClock(ms = 1100) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockApplySample.mockClear();
  canbusState.phase = "online";
  canbusState.simulated = false;
  canbusState.telemetry = { speed: 88 };
  canbusState.lastUpdate = Date.now();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Meter Digital", () => {
  it("bills on the vehicle's own speed when a real reader is linked", async () => {
    const { getByLabelText } = render(<MeterDigital />);
    await startHire(getByLabelText);

    await tickClock();
    expect(mockApplySample).toHaveBeenCalled();
    const sample = mockApplySample.mock.calls.at(-1)![0];
    expect(sample.obdSpeedKmh).toBe(88);
    expect(sample.obdUpdatedAt).toEqual(expect.any(Number));
  });

  it("withholds simulated speed, so Demo Mode can never bill a fare", async () => {
    canbusState.simulated = true;
    canbusState.telemetry = { speed: 120 };

    const { getByLabelText } = render(<MeterDigital />);
    await startHire(getByLabelText);

    await tickClock();
    expect(mockApplySample).toHaveBeenCalled();
    const sample = mockApplySample.mock.calls.at(-1)![0];
    // The invented speed must not reach the meter at all.
    expect(sample.obdSpeedKmh).toBeNull();
    expect(sample.obdUpdatedAt).toBeNull();
    // GPS still supplies a speed, so the hire accrues honestly.
    expect(sample.gpsSpeedKmh).toBeCloseTo(36);
  });

  it("flags Demo Mode beside the connection type rather than folding it in", async () => {
    canbusState.simulated = true;
    const { findByText } = render(<MeterDigital />);
    expect(await findByText(/DEMO/)).toBeTruthy();
  });

  it("does not treat a simulated session as a vehicle link", async () => {
    canbusState.simulated = true;
    const { queryByText } = render(<MeterDigital />);
    await waitFor(() => expect(queryByText(/GPS \+ OBD-II/)).toBeNull());
  });

  it("names the connection as GPS + OBD-II once a real reader and a fix are present", async () => {
    const { findByText } = render(<MeterDigital />);
    expect(await findByText(/GPS \+ OBD-II/)).toBeTruthy();
  });

  it("passes no OBD speed at all when no reader is linked", async () => {
    canbusState.phase = "idle";
    canbusState.telemetry = {};
    canbusState.lastUpdate = null as unknown as number;

    const { getByLabelText } = render(<MeterDigital />);
    await startHire(getByLabelText);

    await tickClock();
    expect(mockApplySample).toHaveBeenCalled();
    const sample = mockApplySample.mock.calls.at(-1)![0];
    expect(sample.obdSpeedKmh ?? null).toBeNull();
  });

  it("ignores samples until the hire is started", async () => {
    render(<MeterDigital />);
    // Let the 1 Hz clock run without a hire in progress.
    await tickClock(3000);
    expect(mockApplySample).not.toHaveBeenCalled();
  });
});
