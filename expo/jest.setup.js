/* global jest */

// Official in-memory AsyncStorage mock — lets the utils/*Store.ts local
// fallback paths run for real (reads/writes survive within a test).
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// utils/maps.ts re-exports MapView/Marker/… from react-native-maps, which
// needs native modules that don't exist under Jest. The logic under test
// (calculateFare, decodePolyline) never touches these components.
jest.mock("react-native-maps", () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
  MarkerAnimated: () => null,
  AnimatedRegion: function AnimatedRegion() {},
  Polyline: () => null,
  Polygon: () => null,
}));

// utils/rideRequestsStore.ts imports expo-location at module scope for
// request metadata; none of the tested code paths call it.
jest.mock("expo-location", () => ({}));
