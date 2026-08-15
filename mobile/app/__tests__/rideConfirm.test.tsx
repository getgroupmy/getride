import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";

/**
 * Ride confirm.
 *
 * This screen quotes a price and then creates the request that a driver will
 * be dispatched against, so the things worth pinning down are: the fare comes
 * from the shared tariff arithmetic rather than a second implementation, the
 * request carries the trip it was quoted for, and a failure never leaves the
 * rider believing a ride was booked when it was not.
 */

const mockParams: Record<string, string> = {
  pickupLat: "3.1",
  pickupLng: "101.7",
  pickupName: "Home",
  dropLat: "3.2",
  dropLng: "101.8",
  dropName: "KLCC",
  dropAddress: "Jalan Ampang",
};

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

// A signed-in, unlocked account. The screens are guarded by useRequireAuth,
// which reads isAuthenticated / profileLoaded / hasPin as well as userId.
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isLoading: false,
    authState: {
      userId: "rider-1",
      profileName: "Rider",
      phone: "+60123456789",
      isAuthenticated: true,
      hasPin: false,
      profileLoaded: true,
    },
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff", card: "#eee", border: "#ccc", text: "#000",
    textSecondary: "#333", subtext: "#666", primary: "#00f", onAccent: "#fff", error: "#f00",
  }),
}));

jest.mock("@/components/RideMap", () => "RideMap");

const mockCalculateRoute = jest.fn();
jest.mock("@/utils/maps", () => {
  const actual = jest.requireActual("@/utils/maps");
  return {
    ...actual,
    calculateRoute: (...a: unknown[]) => mockCalculateRoute(...a),
    // calculateFare stays real: a quoted fare that disagreed with the meter
    // would be the exact defect this screen exists to avoid.
    calculateFare: actual.calculateFare,
  };
});

const mockCreate = jest.fn();
const mockNotify = jest.fn();
const mockIsPermissionDenied = jest.fn();
jest.mock("@/utils/rideRequestsStore", () => ({
  createRideRequest: (...a: unknown[]) => mockCreate(...a),
  notifyPartnersOfNewRequest: (...a: unknown[]) => mockNotify(...a),
  isPermissionDeniedError: (...a: unknown[]) => mockIsPermissionDenied(...a),
  RIDE_SIGN_IN_MESSAGE: "Please sign in again.",
}));

// eslint-disable-next-line import/first
import RideConfirm from "@/app/ride-confirm";
// eslint-disable-next-line import/first
import { calculateFare } from "@/utils/maps";

/**
 * Render, wait until the fare has been quoted, then press Request.
 *
 * The button is disabled until an estimate exists, so pressing the element as
 * soon as it can be found is a no-op — the press has to wait for the quote.
 */
async function renderAndRequest() {
  const utils = render(<RideConfirm />);
  const { fireEvent } = jest.requireActual("@testing-library/react-native");
  // The button's label is constant; its *text* is what changes once a fare
  // exists, so that is the signal the press will actually land.
  await utils.findByText(/^Request for /);
  await act(async () => {
    fireEvent.press(utils.getByLabelText("Request this ride"));
  });
  return utils;
}

const ROUTE = {
  distance: 8200,
  duration: 900,
  coordinates: [
    { latitude: 3.1, longitude: 101.7 },
    { latitude: 3.2, longitude: 101.8 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCalculateRoute.mockResolvedValue(ROUTE);
  mockCreate.mockResolvedValue({ id: "req-1" });
  mockNotify.mockResolvedValue(undefined);
  mockIsPermissionDenied.mockReturnValue(false);
});

describe("ride-confirm", () => {
  it("quotes the fare with the shared tariff arithmetic", async () => {
    const { findByText } = render(<RideConfirm />);
    const expected = calculateFare(8.2, 15);
    expect(await findByText(`RM ${expected.toFixed(2)}`)).toBeTruthy();
  });

  it("shows the distance and time it priced", async () => {
    const { findByText } = render(<RideConfirm />);
    expect(await findByText("8.2 km")).toBeTruthy();
    expect(await findByText("15 min")).toBeTruthy();
  });

  it("creates the request for the trip it quoted", async () => {
    await renderAndRequest();

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const input = mockCreate.mock.calls[0][0];
    expect(input).toMatchObject({
      riderId: "rider-1",
      pickupLat: 3.1,
      pickupLng: 101.7,
      dropLat: 3.2,
      dropLng: 101.8,
      dropName: "KLCC",
      distanceKm: 8.2,
    });
    expect(input.fare).toBeCloseTo(calculateFare(8.2, 15));
  });

  it("hands the rider to tracking once the request exists", async () => {
    await renderAndRequest();

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/ride-tracking",
        params: { id: "req-1" },
      })
    );
  });

  it("does not navigate when the request could not be created", async () => {
    mockCreate.mockResolvedValue(null);
    const { findByText } = await renderAndRequest();

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await findByText(/couldn't send that request/i)).toBeTruthy();
  });

  it("still books when notifying partners fails, since the row already exists", async () => {
    mockNotify.mockRejectedValue(new Error("push down"));
    await renderAndRequest();

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  it("reports that no route could be found instead of quoting nothing", async () => {
    mockCalculateRoute.mockResolvedValue(null);
    const { findByText } = render(<RideConfirm />);
    expect(await findByText(/couldn't find a route/i)).toBeTruthy();
  });

  it("does not create a request while there is no estimate", async () => {
    mockCalculateRoute.mockResolvedValue(null);
    const { findByLabelText } = render(<RideConfirm />);
    const { fireEvent } = jest.requireActual("@testing-library/react-native");
    await act(async () => {
      fireEvent.press(await findByLabelText("Request this ride"));
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
