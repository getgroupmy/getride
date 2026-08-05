/**
 * QR scanning camera — native implementation.
 *
 * Screens must import *this* module rather than `expo-camera` directly. The web
 * build of `expo-camera` spins up a Web Worker at module scope, and because
 * expo-router loads every route file eagerly at startup, that side effect ran
 * during boot and took the whole navigator down. Routing the camera through a
 * platform-split component keeps `expo-camera` out of the web bundle entirely.
 *
 * The web twin lives in `QrScanCamera.web.tsx` and exposes the same API.
 */

import React, { useCallback } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";

/** The subset of a camera permission the wallet screens actually read. */
export interface QrCameraPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export type QrCameraPermissionHook = [
  QrCameraPermission | null,
  () => Promise<void>,
];

/**
 * Camera permission state plus a request trigger.
 *
 * Mirrors `useCameraPermissions()` but narrowed to the two flags the screens
 * use, so the web twin can satisfy the same contract without expo-camera.
 */
export function useQrCameraPermission(): QrCameraPermissionHook {
  const [permission, requestPermission] = useCameraPermissions();
  const request = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);
  return [
    permission ? { granted: permission.granted, canAskAgain: permission.canAskAgain } : null,
    request,
  ];
}

export interface QrScanCameraProps {
  style?: StyleProp<ViewStyle>;
  /** Scanning is only reported while this is true — pause it behind a sheet. */
  active?: boolean;
  torch?: boolean;
  /** Raw payload of the decoded QR code. */
  onScanned: (data: string) => void;
  testID?: string;
}

export default function QrScanCamera({
  style,
  active = true,
  torch = false,
  onScanned,
  testID,
}: QrScanCameraProps) {
  const handleBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (!result?.data) return;
      onScanned(result.data);
    },
    [onScanned],
  );

  return (
    <CameraView
      style={style ?? StyleSheet.absoluteFill}
      facing="back"
      enableTorch={torch}
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={active ? handleBarcode : undefined}
      testID={testID}
    />
  );
}
