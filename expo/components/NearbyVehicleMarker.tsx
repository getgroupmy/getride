import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { Navigation } from "lucide-react-native";
import { MarkerAnimated, AnimatedRegion, Marker } from "@/utils/maps";
import { getVehicle, subscribeVehicle, VehicleState } from "@/utils/vehicleStore";

export type NearbyVehicle = VehicleState;

const COLOR_BY_TYPE: Record<string, string> = {
  ride: "#111111",
  comfort: "#0F4C81",
  "6seater": "#1F7A3A",
  premium: "#8B5A00",
};

const ANIM_MS = 1000;

type Props = {
  id: string;
  type: string;
  initialLatitude: number;
  initialLongitude: number;
  initialHeading: number;
};

function VehicleBody({ heading, color }: { heading: Animated.Value; color: string }) {
  const rotate = heading.interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"] });
  return (
    <View style={styles.markerWrap}>
      <View style={styles.shadow} />
      <Animated.View style={[styles.iconBg, { backgroundColor: color, transform: [{ rotate }] }]}>
        <Navigation size={16} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
      </Animated.View>
    </View>
  );
}

const NearbyVehicleMarker = React.memo(
  function NearbyVehicleMarker({ id, type, initialLatitude, initialLongitude, initialHeading }: Props) {
    const color = COLOR_BY_TYPE[type] ?? "#111111";

    const coordRef = useRef<any>(
      AnimatedRegion
        ? new (AnimatedRegion as any)({
            latitude: initialLatitude,
            longitude: initialLongitude,
            latitudeDelta: 0,
            longitudeDelta: 0,
          })
        : null
    );
    const headingAnim = useRef(new Animated.Value(initialHeading)).current;
    const lastHeadingRef = useRef<number>(initialHeading);
    const [tracks, setTracks] = useState<boolean>(true);

    useEffect(() => {
      const t = setTimeout(() => setTracks(false), 800);
      return () => clearTimeout(t);
    }, []);

    useEffect(() => {
      const apply = (v: VehicleState) => {
        if (coordRef.current && typeof coordRef.current.timing === "function") {
          coordRef.current
            .timing({
              latitude: v.latitude,
              longitude: v.longitude,
              duration: ANIM_MS,
              useNativeDriver: false,
            })
            .start();
        }
        let target = v.heading;
        const last = lastHeadingRef.current;
        const diff = ((target - last + 540) % 360) - 180;
        target = last + diff;
        lastHeadingRef.current = target;
        Animated.timing(headingAnim, {
          toValue: target,
          duration: ANIM_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
      };

      const initial = getVehicle(id);
      if (initial) apply(initial);
      const unsub = subscribeVehicle(id, apply);
      return unsub;
    }, [id, headingAnim]);

    if (Platform.OS === "web" || !MarkerAnimated || !Marker) return null;

    const MA: any = MarkerAnimated;

    return (
      <MA
        coordinate={coordRef.current}
        anchor={{ x: 0.5, y: 0.5 }}
        flat
        tracksViewChanges={tracks}
        testID={`nearby-vehicle-${id}`}
      >
        <VehicleBody heading={headingAnim} color={color} />
      </MA>
    );
  },
  (prev, next) => prev.id === next.id && prev.type === next.type
);

export default NearbyVehicleMarker;

const styles = StyleSheet.create({
  markerWrap: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  shadow: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.18)",
    top: 5,
  },
  iconBg: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
});
