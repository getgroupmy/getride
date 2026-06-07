import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Polygon } from "@/utils/maps";

type LatLng = { latitude: number; longitude: number };

interface HeatmapOverlayProps {
  center: LatLng;
  visible: boolean;
  /** Approximate hex side length in km. Defaults to ~3.5km. */
  hexSizeKm?: number;
  /** Number of hex rings around the center. Defaults give ~50km coverage. */
  rings?: number;
  /** Stable seed so hexes keep the same intensity between renders. */
  seed?: number;
  /** Optional hotspots that boost intensity around them. */
  hotspots?: LatLng[];
  /** Drift hot zones over time for a living, dynamic feel. */
  animated?: boolean;
}

/**
 * Honeycomb-style demand heat map overlay (Uber-like).
 * Renders flat-top hexagons with intensity-based fill colors.
 * Optionally focuses heat around provided hotspots and drifts them over time.
 */
function HeatmapOverlayInternal({
  center,
  visible,
  hexSizeKm = 3.5,
  rings = 14,
  seed = 1,
  hotspots,
  animated = true,
}: HeatmapOverlayProps) {
  const [tick, setTick] = useState<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible || !animated) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = setInterval(() => {
      setTick((t) => (t + 1) % 100000);
    }, 4000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [visible, animated]);

  const hexes = useMemo(() => {
    if (!visible) return [];

    const kmPerDegLat = 110.574;
    const kmPerDegLng = 111.32 * Math.cos((center.latitude * Math.PI) / 180);
    const size = hexSizeKm;

    const horiz = (Math.sqrt(3) * size) / kmPerDegLng;
    const vert = ((3 / 2) * size) / kmPerDegLat;

    const hexRadiusLat = size / kmPerDegLat;
    const hexRadiusLng = size / kmPerDegLng;

    const cells: {
      key: string;
      coordinates: LatLng[];
      intensity: number;
    }[] = [];

    const phase = tick * 0.35;
    const pseudoRandom = (q: number, r: number, p: number) => {
      const x =
        Math.sin(q * 127.1 + r * 311.7 + seed * 13.37 + p * 7.91) *
        43758.5453;
      return x - Math.floor(x);
    };

    // Pre-compute hotspot influences in km from center
    const hotspotKm = (hotspots ?? []).map((h) => {
      const dLat = (h.latitude - center.latitude) * kmPerDegLat;
      const dLng = (h.longitude - center.longitude) * kmPerDegLng;
      return { x: dLng, y: dLat };
    });

    for (let q = -rings; q <= rings; q++) {
      for (let r = -rings; r <= rings; r++) {
        const s = -q - r;
        if (Math.abs(s) > rings) continue;

        const lng = center.longitude + horiz * (q + r / 2);
        const lat = center.latitude - vert * r;

        const dist = Math.sqrt(q * q + r * r + s * s) / 2;
        const falloff = Math.max(0, 1 - dist / (rings + 1));

        // Drifting noise gives a "breathing" feel
        const drift =
          pseudoRandom(q, r, Math.floor(phase)) * (1 - (phase % 1)) +
          pseudoRandom(q, r, Math.floor(phase) + 1) * (phase % 1);

        // Hotspot boost: gaussian falloff around each hotspot
        let hotBoost = 0;
        if (hotspotKm.length > 0) {
          const cellX = horiz * (q + r / 2) * kmPerDegLng;
          const cellY = -vert * r * kmPerDegLat;
          for (const h of hotspotKm) {
            const dx = cellX - h.x;
            const dy = cellY - h.y;
            const d2 = dx * dx + dy * dy;
            // sigma ~ 8km for wider 50km coverage
            const sigma2 = 64;
            hotBoost += Math.exp(-d2 / (2 * sigma2));
          }
          hotBoost = Math.min(1, hotBoost);
        }

        const base =
          hotspotKm.length > 0
            ? hotBoost * 0.85 + falloff * 0.15
            : falloff * 0.7 + drift * 0.55;
        const intensity = Math.min(1, base + drift * 0.25);

        if (intensity < 0.2) continue;

        const coordinates: LatLng[] = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i + Math.PI / 6;
          coordinates.push({
            latitude: lat + hexRadiusLat * Math.sin(angle),
            longitude: lng + hexRadiusLng * Math.cos(angle),
          });
        }

        cells.push({
          key: `${q}_${r}`,
          coordinates,
          intensity,
        });
      }
    }
    return cells;
  }, [
    visible,
    center.latitude,
    center.longitude,
    hexSizeKm,
    rings,
    seed,
    hotspots,
    tick,
  ]);

  if (!visible || Platform.OS === "web" || !Polygon) return null;

  return (
    <>
      {hexes.map((h) => {
        const color = intensityToColor(h.intensity);
        return (
          <Polygon
            key={h.key}
            coordinates={h.coordinates}
            fillColor={color.fill}
            strokeColor={color.stroke}
            strokeWidth={1}
            tappable={false}
          />
        );
      })}
    </>
  );
}

function intensityToColor(t: number): { fill: string; stroke: string } {
  const stops: { t: number; r: number; g: number; b: number }[] = [
    { t: 0.0, r: 16, g: 185, b: 129 },
    { t: 0.45, r: 245, g: 158, b: 11 },
    { t: 0.75, r: 239, g: 68, b: 68 },
    { t: 1.0, r: 190, g: 18, b: 60 },
  ];
  let c1 = stops[0];
  let c2 = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      c1 = stops[i];
      c2 = stops[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, c2.t - c1.t);
  const k = (t - c1.t) / span;
  const r = Math.round(c1.r + (c2.r - c1.r) * k);
  const g = Math.round(c1.g + (c2.g - c1.g) * k);
  const b = Math.round(c1.b + (c2.b - c1.b) * k);
  const alpha = Math.round((0.18 + t * 0.4) * 255)
    .toString(16)
    .padStart(2, "0");
  const strokeAlpha = Math.round(0.55 * 255)
    .toString(16)
    .padStart(2, "0");
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return {
    fill: `#${hex(r)}${hex(g)}${hex(b)}${alpha}`,
    stroke: `#${hex(r)}${hex(g)}${hex(b)}${strokeAlpha}`,
  };
}

export default React.memo(HeatmapOverlayInternal);
