import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";

/**
 * Ride running — the driver's side of a claimed trip.
 *
 * The stakes here are the commission charge: it moves real money out of a
 * driver's GET.credit, and it happens automatically at the end of a trip. So
 * what is worth pinning down is that it fires once, only after completion, and
 * that its failure is never presented to the driver as a failed trip.
 */

const mockRide: Record<string, unknown> = {
  id: "req-1",
  status: "accepted",
  pickup_lat: 3.1,
  pickup_lng: 101.7,
  pickup_name: "Home",
  drop_lat: 3.2,
  drop_lng: 101.8,
  drop_name: "KLCC",
  rider_name: "Rider",
  fare: 24,
  partner_live_lat: null,
  partner_live_lng: null,
};

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: "req-1" }),
}));

// A signed-in, unlocked account. The screens are guarded by useRequireAuth,
// which reads isAuthenticated / profileLoaded / hasPin as well as userId.
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isLoading: false,
    authState: {
      userId: "driver-1",
      profileName: "Driver",
      phone: null,
      isAuthenticated: true,
      hasPin: false,
      profileLoaded: true,
    },
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff", card: "#eee", border: "#ccc", text: "#000",
    textSecondary: "#333", subtext: "#666", primary: "#00f", onAccent: "#fff",
    error: "#f00", success: "#0a0",
  }),
}));

jest.mock("@/components/RideMap", () => "RideMap");

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  getCurrentPositionAsync: jest.fn(),
}));

const mockFetchRide = jest.fn();
const mockUpdateStatus = jest.fn();
const mockComplete = jest.fn();
const mockPublish = jest.fn();
jest.mock("@/utils/rideRequestsStore", () => ({
  fetchRideRequest: (...a: unknown[]) => mockFetchRide(...a),
  updateRideRequestStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  completeRideRequest: (...a: unknown[]) => mockComplete(...a),
  publishLiveLocation: (...a: unknown[]) => mockPublish(...a),
  subscribeToRideRequest: () => () => {},
}));

const mockCharge = jest.fn();
jest.mock("@/utils/walletStore", () => ({
  chargeRideCommission: (...a: unknown[]) => mockCharge(...a),
}));

// eslint-disable-next-line import/first
import RideRunning from "@/app/ride-running";

const { fireEvent } = jest.requireActual("@testing-library/react-native");

/** Render and press the single forward action available at this stage. */
async function renderAndAdvance(label: string) {
  const utils = render(<RideRunning />);
  const btn = await utils.findByLabelText(label);
  await act(async () => {
    fireEvent.press(btn);
  });
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRide.status = "accepted";
  mockRide.fare = 24;
  mockFetchRide.mockResolvedValue({ ...mockRide });
  mockUpdateStatus.mockResolvedValue(true);
  mockComplete.mockResolvedValue(true);
  mockCharge.mockResolvedValue({ ok: true });
});

describe("ride-running", () => {
  it("offers arrival as the next step of an accepted ride", async () => {
    const { findByLabelText } = render(<RideRunning />);
    expect(await findByLabelText("I've arrived")).toBeTruthy();
  });

  it("moves an accepted ride to arrived without touching commission", async () => {
    await renderAndAdvance("I've arrived");
    await waitFor(() => expect(mockUpdateStatus).toHaveBeenCalledWith("req-1", "arrived"));
    expect(mockCharge).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("starts the trip from arrived", async () => {
    mockRide.status = "arrived";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    await renderAndAdvance("Start trip");
    await waitFor(() => expect(mockUpdateStatus).toHaveBeenCalledWith("req-1", "on_trip"));
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("charges commission on the completed fare, once", async () => {
    mockRide.status = "on_trip";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    await renderAndAdvance("End trip");

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith("req-1"));
    await waitFor(() =>
      expect(mockCharge).toHaveBeenCalledWith({
        partnerId: "driver-1",
        fareTotal: 24,
        rideRequestId: "req-1",
      })
    );
    expect(mockCharge).toHaveBeenCalledTimes(1);
  });

  it("does not charge when the trip could not be completed", async () => {
    mockRide.status = "on_trip";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    mockComplete.mockResolvedValue(false);
    await renderAndAdvance("End trip");

    await waitFor(() => expect(mockComplete).toHaveBeenCalled());
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("does not charge a zero fare", async () => {
    mockRide.status = "on_trip";
    mockRide.fare = 0;
    mockFetchRide.mockResolvedValue({ ...mockRide });
    await renderAndAdvance("End trip");

    await waitFor(() => expect(mockComplete).toHaveBeenCalled());
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("treats a failed commission charge as a completed trip, not a failed one", async () => {
    mockRide.status = "on_trip";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    mockCharge.mockResolvedValue({ ok: false, error: "insufficient credit" });

    const { queryByText } = await renderAndAdvance("End trip");
    await waitFor(() => expect(mockCharge).toHaveBeenCalled());
    // The fare is collected either way and the ledger reconciles server-side,
    // so the driver is not told their trip failed.
    expect(queryByText(/couldn't end the trip/i)).toBeNull();
  });

  it("offers no forward action once the ride is finished", async () => {
    mockRide.status = "completed";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    const { queryByLabelText, findByLabelText } = render(<RideRunning />);
    expect(await findByLabelText("Back to requests")).toBeTruthy();
    expect(queryByLabelText("End trip")).toBeNull();
  });

  it("does not publish a position once the ride is no longer active", async () => {
    mockRide.status = "completed";
    mockFetchRide.mockResolvedValue({ ...mockRide });
    render(<RideRunning />);
    await waitFor(() => expect(mockFetchRide).toHaveBeenCalled());
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
