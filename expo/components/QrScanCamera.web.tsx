/**
 * QR scanning camera — web implementation.
 *
 * Deliberately does **not** import `expo-camera`. Its web build creates a Web
 * Worker at module scope (`useWebQRScanner`), and expo-router requires every
 * route file eagerly at startup, so merely having a scanner screen in the app
 * crashed the navigator before the first frame. Here the camera is opened with
 * `getUserMedia` only once the component mounts, and nothing runs at import.
 *
 * Decoding prefers the native `BarcodeDetector`; where it is missing the jsQR
 * script is pulled in on demand and run on the main thread at a modest 6 fps.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

export interface QrCameraPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export type QrCameraPermissionHook = [
  QrCameraPermission | null,
  () => Promise<void>,
];

const JSQR_SRC = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: string },
) => { data?: string } | null;

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue?: string }[]>;
}

interface ScannerGlobals {
  BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  jsQR?: JsQrFn;
}

function scannerGlobals(): ScannerGlobals {
  return globalThis as unknown as ScannerGlobals;
}

function hasMediaDevices(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Load jsQR once, lazily. Resolves to null when the CDN is unreachable. */
let jsQrPromise: Promise<JsQrFn | null> | null = null;
function loadJsQr(): Promise<JsQrFn | null> {
  if (scannerGlobals().jsQR) return Promise.resolve(scannerGlobals().jsQR ?? null);
  if (jsQrPromise) return jsQrPromise;
  jsQrPromise = new Promise<JsQrFn | null>((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const script = document.createElement("script");
    script.src = JSQR_SRC;
    script.async = true;
    script.onload = () => resolve(scannerGlobals().jsQR ?? null);
    script.onerror = () => {
      console.log("[QrScanCamera] jsQR failed to load");
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return jsQrPromise;
}

/**
 * Camera permission state on the web, backed by `getUserMedia`.
 *
 * Browsers have no "ask again" concept the way the native prompts do, so a
 * refusal reports `canAskAgain: false` and the screens fall back to their
 * "open settings" copy — which on the web is the site permission chip.
 */
export function useQrCameraPermission(): QrCameraPermissionHook {
  const [permission, setPermission] = useState<QrCameraPermission | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!hasMediaDevices()) {
        if (!cancelled) setPermission({ granted: false, canAskAgain: false });
        return;
      }
      try {
        const status = await navigator.permissions?.query({
          name: "camera" as PermissionName,
        });
        if (cancelled) return;
        if (status?.state === "granted") {
          setPermission({ granted: true, canAskAgain: false });
          return;
        }
        setPermission({ granted: false, canAskAgain: status?.state !== "denied" });
      } catch {
        // Safari has no camera permission descriptor — assume we may ask.
        if (!cancelled) setPermission({ granted: false, canAskAgain: true });
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async () => {
    if (!hasMediaDevices()) {
      setPermission({ granted: false, canAskAgain: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermission({ granted: true, canAskAgain: false });
    } catch (e) {
      console.log("[QrScanCamera] camera permission refused", e);
      setPermission({ granted: false, canAskAgain: false });
    }
  }, []);

  return [permission, request];
}

export interface QrScanCameraProps {
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  torch?: boolean;
  onScanned: (data: string) => void;
  testID?: string;
}

export default function QrScanCamera({
  style,
  active = true,
  onScanned,
  testID,
}: QrScanCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<boolean>(active);
  const onScannedRef = useRef(onScanned);
  activeRef.current = active;
  onScannedRef.current = onScanned;

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
  }, []);

  useEffect(() => {
    if (!hasMediaDevices()) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detector: BarcodeDetectorLike | null = null;
    let jsQr: JsQrFn | null = null;

    const decodeFrame = async (): Promise<string | null> => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;
      if (detector) {
        try {
          const found = await detector.detect(video);
          const value = found.find((f) => f.rawValue)?.rawValue;
          if (value) return value;
        } catch {
          // A detector that throws once is not worth retrying every frame.
          detector = null;
        }
      }
      if (!jsQr) return null;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return jsQr(image.data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
    };

    const tick = async () => {
      if (stopped) return;
      if (activeRef.current) {
        try {
          const value = await decodeFrame();
          if (value && !stopped && activeRef.current) onScannedRef.current(value);
        } catch (e) {
          console.log("[QrScanCamera] decode failed", e);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), 160);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        console.log("[QrScanCamera] camera unavailable", e);
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        try {
          await video.play();
        } catch (e) {
          console.log("[QrScanCamera] video play blocked", e);
        }
      }

      const Detector = scannerGlobals().BarcodeDetector;
      if (Detector) {
        try {
          detector = new Detector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      if (!detector) jsQr = await loadJsQr();
      if (!stopped) void tick();
    };

    void start();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const video = videoRef.current;
      if (video) video.srcObject = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <View style={style ?? StyleSheet.absoluteFill} testID={testID}>
      {React.createElement("video", {
        ref: attachVideo,
        autoPlay: true,
        muted: true,
        playsInline: true,
        style: { width: "100%", height: "100%", objectFit: "cover" },
      })}
    </View>
  );
}
