/**
 * Development-only telemetry simulator.
 *
 * Streams plausible vehicle telemetry so the System Status panel and the
 * speed pill can be exercised in Expo Go / on web without a real adapter.
 * It is always reported honestly (`simulated: true`) and only runs when the
 * partner-side simulation flag is on — never presented as a live vehicle.
 */

import type { Telemetry } from "./obd";

export interface Simulator {
  stop: () => void;
}

/** Drive a gently-varying telemetry stream to `onTelemetry` every `intervalMs`. */
export function startSimulator(
  onTelemetry: (telemetry: Telemetry, at: number) => void,
  intervalMs = 1000,
): Simulator {
  let t = 0;
  let speed = 0;
  const timer = setInterval(() => {
    t += 1;
    // A smooth-ish drive cycle: accelerate, cruise, slow, repeat.
    const phase = (t % 40) / 40;
    const target = phase < 0.5 ? 70 * (phase / 0.5) : 70 * (1 - (phase - 0.5) / 0.5);
    speed += (target - speed) * 0.3;
    const speedKmh = Math.max(0, Math.round(speed));
    const rpm = 800 + speedKmh * 45 + Math.round(Math.sin(t / 3) * 120);
    onTelemetry(
      {
        speed: speedKmh,
        rpm,
        coolantTemp: 88 + Math.round(Math.sin(t / 10) * 3),
        engineLoad: 18 + speedKmh * 0.7,
        throttle: Math.min(100, 8 + speedKmh * 0.9),
        fuelLevel: 62,
        moduleVoltage: 13.9 + Math.sin(t / 7) * 0.2,
        intakeTemp: 34,
      },
      Date.now(),
    );
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
