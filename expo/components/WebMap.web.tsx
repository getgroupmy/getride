import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import L from "leaflet";

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

const LIGHT_TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DARK_TILES =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const SATELLITE_ATTRIBUTION =
  "Imagery &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics";

const DEFAULT_ACCENT = "#2dabe2";

/** Convert a react-native-maps latitudeDelta into a Leaflet zoom level. */
function zoomForDelta(latitudeDelta: number): number {
  const zoom = Math.log2(360 / Math.max(latitudeDelta, 0.0005));
  return Math.min(19, Math.max(3, zoom));
}

function regionFromMap(map: L.Map): WebMapRegion {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
    longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
  };
}

/** Inject the Leaflet stylesheet + custom marker CSS exactly once. */
function ensureLeafletAssets(): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById("wm-leaflet-css")) {
    const link = document.createElement("link");
    link.id = "wm-leaflet-css";
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }
  if (!document.getElementById("wm-marker-css")) {
    const style = document.createElement("style");
    style.id = "wm-marker-css";
    style.textContent = `
      .wm-icon { background: transparent; border: none; }
      .wm-user-wrap { position: relative; width: 36px; height: 36px; }
      .wm-user-halo {
        position: absolute; left: 0; top: 0; width: 36px; height: 36px;
        border-radius: 50%; opacity: 0.25;
        animation: wm-pulse 2s ease-out infinite;
      }
      .wm-user-dot {
        position: absolute; left: 10px; top: 10px; width: 16px; height: 16px;
        border-radius: 50%; border: 3px solid #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
      }
      @keyframes wm-pulse {
        0% { transform: scale(0.6); opacity: 0.45; }
        70% { transform: scale(1.4); opacity: 0; }
        100% { transform: scale(1.4); opacity: 0; }
      }
      .wm-pickup {
        width: 22px; height: 22px; border-radius: 50%;
        border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
      }
      .wm-pickup-inner { width: 6px; height: 6px; border-radius: 3px; background: #fff; }
      .wm-dest {
        width: 30px; height: 30px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      }
      .wm-nav-circle {
        width: 30px; height: 30px; border-radius: 50%;
        border: 2.5px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        display: flex; align-items: center; justify-content: center;
      }
    `;
    document.head.appendChild(style);
  }
}

const NAV_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="1"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>';
const PIN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

function buildIcon(spec: WebMapMarkerSpec, accent: string): L.DivIcon {
  const color = spec.color ?? accent;
  const heading = typeof spec.heading === "number" ? spec.heading : 0;
  switch (spec.kind) {
    case "user":
      return L.divIcon({
        className: "wm-icon",
        html: `<div class="wm-user-wrap"><div class="wm-user-halo" style="background:${color}"></div><div class="wm-user-dot" style="background:${color}"></div></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
    case "pickup":
      return L.divIcon({
        className: "wm-icon",
        html: `<div class="wm-pickup" style="background:${color}"><div class="wm-pickup-inner"></div></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
    case "dest":
      return L.divIcon({
        className: "wm-icon",
        html: `<div class="wm-dest" style="background:${spec.color ?? "#111827"}">${PIN_SVG}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 28],
      });
    case "driver":
    case "vehicle":
      return L.divIcon({
        className: "wm-icon",
        html: `<div class="wm-nav-circle" style="background:${color};transform:rotate(${heading}deg)">${NAV_SVG}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
    default:
      return L.divIcon({
        className: "wm-icon",
        html: `<div class="wm-pickup" style="background:${color}"><div class="wm-pickup-inner"></div></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
  }
}

/**
 * Interactive Leaflet + OpenStreetMap map for web builds. Mirrors the
 * subset of the react-native-maps API the app uses (animateToRegion,
 * setCamera, animateCamera, fitToCoordinates, region change callbacks)
 * so screens can share a single mapRef across platforms.
 */
const WebMap = forwardRef<WebMapHandle, WebMapProps>(function WebMap(
  {
    style,
    initialRegion,
    dark = false,
    accentColor = DEFAULT_ACCENT,
    markers = [],
    polylines = [],
    userLocation = null,
    interactive = true,
    satellite = false,
    onRegionChange,
    onRegionChangeComplete,
    onPanDrag,
    testID,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());
  const polyMapRef = useRef<Map<string, L.Polyline>>(new Map());
  const userMarkerRef = useRef<L.Marker | null>(null);
  const callbacksRef = useRef({ onRegionChange, onRegionChangeComplete, onPanDrag });
  callbacksRef.current = { onRegionChange, onRegionChangeComplete, onPanDrag };

  const attachDiv = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;
    ensureLeafletAssets();
    const map = L.map(node, {
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
    });
    map.attributionControl.setPrefix(false);
    map.setView(
      [initialRegion.latitude, initialRegion.longitude],
      zoomForDelta(initialRegion.latitudeDelta)
    );
    mapRef.current = map;

    map.on("move", () => {
      callbacksRef.current.onRegionChange?.(regionFromMap(map));
    });
    map.on("moveend zoomend", () => {
      callbacksRef.current.onRegionChangeComplete?.(regionFromMap(map));
    });
    map.on("dragstart", () => {
      callbacksRef.current.onPanDrag?.();
    });

    // Leaflet mis-sizes when mounted inside animated/flex layouts; nudge it.
    const invalidate = () => map.invalidateSize({ animate: false });
    const t1 = setTimeout(invalidate, 50);
    const t2 = setTimeout(invalidate, 400);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(invalidate);
      observer.observe(node);
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer?.disconnect();
      markerMapRef.current.clear();
      polyMapRef.current.clear();
      userMarkerRef.current = null;
      tileRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tile layer follows light/dark theme and standard/satellite mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      tileRef.current.remove();
      tileRef.current = null;
    }
    const tiles = satellite
      ? L.tileLayer(SATELLITE_TILES, {
          attribution: SATELLITE_ATTRIBUTION,
          maxZoom: 19,
        })
      : L.tileLayer(dark ? DARK_TILES : LIGHT_TILES, {
          attribution: TILE_ATTRIBUTION,
          maxZoom: 19,
          subdomains: "abcd",
        });
    tiles.addTo(map);
    tileRef.current = tiles;
  }, [dark, satellite]);

  // Interactivity toggles (bottom sheet expanded, menu open, static maps).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handlers = [
      map.dragging,
      map.touchZoom,
      map.doubleClickZoom,
      map.scrollWheelZoom,
      map.boxZoom,
      map.keyboard,
    ];
    handlers.forEach((h) => (interactive ? h.enable() : h.disable()));
  }, [interactive]);

  // Diff markers by id.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = markerMapRef.current;
    const nextIds = new Set(markers.map((m) => m.id));
    for (const [id, marker] of existing) {
      if (!nextIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }
    for (const spec of markers) {
      const latLng: L.LatLngExpression = [
        spec.coordinate.latitude,
        spec.coordinate.longitude,
      ];
      const current = existing.get(spec.id);
      if (current) {
        current.setLatLng(latLng);
        current.setIcon(buildIcon(spec, accentColor));
      } else {
        const marker = L.marker(latLng, {
          icon: buildIcon(spec, accentColor),
          interactive: false,
          keyboard: false,
        });
        marker.addTo(map);
        existing.set(spec.id, marker);
      }
    }
  }, [markers, accentColor]);

  // Diff polylines by id.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = polyMapRef.current;
    const nextIds = new Set(polylines.map((p) => p.id));
    for (const [id, line] of existing) {
      if (!nextIds.has(id)) {
        line.remove();
        existing.delete(id);
      }
    }
    for (const spec of polylines) {
      const latLngs: L.LatLngExpression[] = spec.coordinates.map((c) => [
        c.latitude,
        c.longitude,
      ]);
      const current = existing.get(spec.id);
      if (current) {
        current.setLatLngs(latLngs);
        current.setStyle({
          color: spec.color ?? accentColor,
          weight: spec.width ?? 5,
        });
      } else {
        const line = L.polyline(latLngs, {
          color: spec.color ?? accentColor,
          weight: spec.width ?? 5,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        });
        line.addTo(map);
        existing.set(spec.id, line);
      }
    }
  }, [polylines, accentColor]);

  // User location blue dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const latLng: L.LatLngExpression = [
      userLocation.latitude,
      userLocation.longitude,
    ];
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(latLng);
    } else {
      const marker = L.marker(latLng, {
        icon: buildIcon(
          { id: "__user", coordinate: userLocation, kind: "user" },
          accentColor
        ),
        interactive: false,
        keyboard: false,
        zIndexOffset: 500,
      });
      marker.addTo(map);
      userMarkerRef.current = marker;
    }
  }, [userLocation, accentColor]);

  useImperativeHandle(
    ref,
    (): WebMapHandle => ({
      animateToRegion: (region: WebMapRegion, durationMs?: number) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo(
          [region.latitude, region.longitude],
          zoomForDelta(region.latitudeDelta),
          { duration: Math.max(0.2, (durationMs ?? 500) / 1000) }
        );
      },
      setCamera: (cfg: { center?: WebMapLatLng; zoom?: number }) => {
        const map = mapRef.current;
        if (!map) return;
        const center: L.LatLngExpression = cfg.center
          ? [cfg.center.latitude, cfg.center.longitude]
          : map.getCenter();
        map.setView(center, cfg.zoom ?? map.getZoom(), { animate: false });
      },
      animateCamera: (
        cfg: { center?: WebMapLatLng; zoom?: number; heading?: number },
        opts?: { duration?: number }
      ) => {
        const map = mapRef.current;
        if (!map) return;
        const center: L.LatLngExpression = cfg.center
          ? [cfg.center.latitude, cfg.center.longitude]
          : map.getCenter();
        map.flyTo(center, cfg.zoom ?? map.getZoom(), {
          duration: Math.max(0.2, (opts?.duration ?? 600) / 1000),
        });
      },
      fitToCoordinates: (
        coords: WebMapLatLng[],
        opts?: {
          edgePadding?: {
            top: number;
            right: number;
            bottom: number;
            left: number;
          };
          animated?: boolean;
        }
      ) => {
        const map = mapRef.current;
        if (!map || coords.length === 0) return;
        const bounds = L.latLngBounds(
          coords.map((c) => [c.latitude, c.longitude] as [number, number])
        );
        const pad = opts?.edgePadding;
        map.fitBounds(bounds, {
          paddingTopLeft: [pad?.left ?? 40, pad?.top ?? 40],
          paddingBottomRight: [pad?.right ?? 40, pad?.bottom ?? 40],
          animate: opts?.animated !== false,
        });
      },
    }),
    []
  );

  return (
    <View style={style} testID={testID}>
      {React.createElement("div", {
        ref: attachDiv,
        style: { width: "100%", height: "100%" },
      })}
    </View>
  );
});

export default WebMap;
