import { StyleSheet, View, type ViewStyle } from "react-native";

import { MapView, Marker, Polyline } from "@/utils/maps";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RideMapMarker extends LatLng {
  id: string;
  title?: string;
  /** Visual role — pickup, destination, or the moving driver. */
  kind: "pickup" | "drop" | "driver";
}

export interface RideMapProps {
  center: LatLng | null;
  markers?: RideMapMarker[];
  /** Decoded route line, if a route has been calculated. */
  route?: LatLng[];
  style?: ViewStyle;
}

const PIN_COLOR: Record<RideMapMarker["kind"], string> = {
  pickup: "#1B9C4B",
  drop: "#C8321E",
  driver: "#1E5FC8",
};

/** Zoom that comfortably frames a city pickup. */
const DELTA = 0.02;

/**
 * The map, on native.
 *
 * A thin wrapper rather than a feature: it owns framing and pin colour only,
 * so screens describe *what* is on the map and never touch react-native-maps
 * directly. `utils/maps.web.ts` nulls these components out for web, which is
 * why there is a `.web.tsx` sibling.
 */
export default function RideMap({ center, markers = [], route, style }: RideMapProps) {
  // No fix yet: render the empty ground rather than a map centred on nowhere.
  if (!center) return <View style={[styles.fill, style]} />;

  return (
    <MapView
      style={[styles.fill, style]}
      initialRegion={{
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: DELTA,
        longitudeDelta: DELTA,
      }}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {route && route.length > 1 ? (
        <Polyline coordinates={route} strokeWidth={4} strokeColor="#1E5FC8" />
      ) : null}
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.latitude, longitude: m.longitude }}
          title={m.title}
          pinColor={PIN_COLOR[m.kind]}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
