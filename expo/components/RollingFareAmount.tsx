import React, { useEffect, useRef, useState } from "react";
import { Text, type TextStyle, type StyleProp } from "react-native";

interface RollingFareAmountProps {
  /** The final fare value. While `loading` is true this is ignored. */
  value: number | null;
  /** When true, digits flip rapidly and no real value is shown. */
  loading: boolean;
  prefix?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Shows rapidly flipping random digits while a fare is being calculated, then
 * settles on the real value with a short count-up animation. Never displays a
 * placeholder/default value.
 */
function RollingFareAmount({ value, loading, prefix, style }: RollingFareAmountProps) {
  const [display, setDisplay] = useState<number>(0);
  const flipRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (flipRef.current) {
      clearInterval(flipRef.current);
      flipRef.current = null;
    }
    if (settleRef.current) {
      clearInterval(settleRef.current);
      settleRef.current = null;
    }
  };

  useEffect(() => {
    clearTimers();

    if (loading || value == null) {
      // Flip random digits while we wait for the real fare.
      const digits = Math.max(2, String(Math.round(value ?? 99)).length);
      const min = Math.pow(10, digits - 1);
      const max = Math.pow(10, digits) - 1;
      flipRef.current = setInterval(() => {
        setDisplay(Math.floor(min + Math.random() * (max - min)));
      }, 70);
      return clearTimers;
    }

    // Settle: quick count toward the final value.
    const target = Math.round(value);
    setDisplay((prev) => {
      const start = prev > 0 ? prev : Math.max(0, target - 40);
      return start;
    });
    settleRef.current = setInterval(() => {
      setDisplay((prev) => {
        if (prev === target) {
          if (settleRef.current) {
            clearInterval(settleRef.current);
            settleRef.current = null;
          }
          return prev;
        }
        const diff = target - prev;
        const step = Math.max(1, Math.round(Math.abs(diff) / 5));
        return prev + (diff > 0 ? Math.min(step, diff) : Math.max(-step, diff));
      });
    }, 35);

    return clearTimers;
  }, [loading, value]);

  return (
    <Text style={style}>
      {prefix ? `${prefix} ` : ""}
      {display}
    </Text>
  );
}

export default React.memo(RollingFareAmount);
