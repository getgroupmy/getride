import { forwardRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type WebMapLatLng = { latitude: number; longitude: number };
export type WebMapRegion = WebMapLatLng & {
  latitudeDelta: number;
  longitudeDelta: number;
};
export type WebMapMarkerKind = "user" | "pickup" | "dest" | "driver" | "vehicle";
export type WebMapMarkerSpec = {
  id: string;
  coordinate: WebMapLatLng;
  kind: WebMapMarkerKind;
  heading?: number;
  color?: string;
};
export type WebMapPolylineSpec = {
  id: string;
  coordinates: WebMapLatLng[];
  color?: string;
  width?: number;
};

export interface WebMapHandle {
  animateToRegion: (region: WebMapRegion, durationMs?: number) => void;
  setCamera: (cfg: { center?: WebMapLatLng; zoom?: number }) => void;
  animateCamera: (
    cfg: { center?: WebMapLatLng; zoom?: number; heading?: number },
    opts?: { duration?: number }
  ) => void;
  fitToCoordinates: (
    coords: WebMapLatLng[],
    opts?: {
      edgePadding?: { top: number; right: number; bottom: number; left: number };
      animated?: boolean;
    }
  ) => void;
}

interface WebMapProps {
  style?: StyleProp<ViewStyle>;
  initialRegion: WebMapRegion;
  dark?: boolean;
  accentColor?: string;
  markers?: WebMapMarkerSpec[];
  polylines?: WebMapPolylineSpec[];
  userLocation?: WebMapLatLng | null;
  interactive?: boolean;
  /** Show satellite imagery tiles instead of the street map. */
  satellite?: boolean;
  onRegionChange?: (region: WebMapRegion) => void;
  onRegionChangeComplete?: (region: WebMapRegion) => void;
  onPanDrag?: () => void;
  testID?: string;
}

/**
 * Native stub — the real Leaflet map lives in WebMap.web.tsx and is only
 * bundled for web. Native screens render react-native-maps instead, so this
 * component never renders anything on iOS/Android.
 */
const WebMap = forwardRef<WebMapHandle, WebMapProps>(function WebMap(_props, _ref) {
  return null;
});

export default WebMap;
