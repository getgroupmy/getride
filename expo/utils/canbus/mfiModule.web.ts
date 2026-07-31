/**
 * Web override for `mfiModule.ts`. Browsers have no External Accessory
 * framework and no `react-native-bluetooth-classic`, so the transport reports
 * MFi as unsupported and the native package stays out of the web bundle
 * entirely.
 */

export function loadMfiModule(): any | null {
  return null;
}

export function isMfiNativeLinked(): boolean {
  return false;
}
