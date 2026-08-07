/**
 * Web override for `bleModule.ts`. Browsers have no `react-native-ble-plx`
 * (Web Bluetooth is a different API with no ELM327 support here), so the
 * transport reports Bluetooth as unsupported and the native package stays out
 * of the web bundle entirely.
 */

export function loadBleModule(): any | null {
  return null;
}

export function isBleNativeLinked(): boolean {
  return false;
}

export function getSharedBleManager(): any | null {
  return null;
}
