/**
 * Web override for `tcpModule.ts`. Browsers cannot open a raw TCP socket at
 * all, so the transport reports Wi-Fi as unsupported and the native package
 * stays out of the web bundle entirely.
 */

export function loadTcpModule(): any | null {
  return null;
}

export function isTcpNativeLinked(): boolean {
  return false;
}
