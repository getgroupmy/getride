import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, ImagePlus, Check, RefreshCw } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import {
  uploadVehiclePhoto,
  VEHICLE_PHOTO_SLOTS,
  type VehiclePhotoSlot,
  type VehicleRow,
} from "@/utils/vehicleOnboardingStore";

const SLOT_LABEL: Record<VehiclePhotoSlot, string> = {
  front: "Front",
  left: "Left",
  right: "Right",
  back: "Back",
};

const SLOT_HINT: Record<VehiclePhotoSlot, string> = {
  front: "Full front of the vehicle including the plate.",
  left: "Driver-side profile, whole vehicle in frame.",
  right: "Passenger-side profile, whole vehicle in frame.",
  back: "Full rear of the vehicle including the plate.",
};

interface Props {
  vehicleId: string;
  initial?: Pick<VehicleRow, "image_front" | "image_left" | "image_right" | "image_back"> | null;
  /** Fires whenever a photo is successfully uploaded so the parent can persist it. */
  onPhotoUploaded: (slot: VehiclePhotoSlot, url: string) => void;
  onCompletionChange?: (complete: boolean) => void;
  testID?: string;
}

export default function VehiclePhotosUploader({
  vehicleId,
  initial,
  onPhotoUploaded,
  onCompletionChange,
  testID,
}: Props) {
  const Colors = useColors();

  const [photos, setPhotos] = useState<Record<VehiclePhotoSlot, string | null>>({
    front: initial?.image_front ?? null,
    left: initial?.image_left ?? null,
    right: initial?.image_right ?? null,
    back: initial?.image_back ?? null,
  });
  const [busySlot, setBusySlot] = useState<VehiclePhotoSlot | null>(null);

  const complete = useMemo(
    () => VEHICLE_PHOTO_SLOTS.every((s) => Boolean(photos[s])),
    [photos]
  );

  React.useEffect(() => {
    onCompletionChange?.(complete);
  }, [complete, onCompletionChange]);

  const pickFromLibrary = useCallback(async (slot: VehiclePhotoSlot) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "We need access to your photos to upload.");
      return null;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (res.canceled) return null;
    return res.assets?.[0]?.uri ?? null;
  }, []);

  const takePhoto = useCallback(async (slot: VehiclePhotoSlot) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "We need access to the camera.");
      return null;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      cameraType: ImagePicker.CameraType.back,
    });
    if (res.canceled) return null;
    return res.assets?.[0]?.uri ?? null;
  }, []);

  const handleUpload = useCallback(
    async (slot: VehiclePhotoSlot, uri: string) => {
      setBusySlot(slot);
      try {
        const url = await uploadVehiclePhoto(uri, vehicleId, slot);
        if (!url) {
          Alert.alert("Upload failed", "Please try again.");
          return;
        }
        setPhotos((prev) => ({ ...prev, [slot]: url }));
        onPhotoUploaded(slot, url);
      } finally {
        setBusySlot(null);
      }
    },
    [vehicleId, onPhotoUploaded]
  );

  const onPick = useCallback(
    (slot: VehiclePhotoSlot) => {
      if (Platform.OS === "web") {
        // Web — only library picker is available.
        void (async () => {
          const uri = await pickFromLibrary(slot);
          if (uri) await handleUpload(slot, uri);
        })();
        return;
      }
      Alert.alert(SLOT_LABEL[slot], "Choose how to add this photo", [
        {
          text: "Take photo",
          onPress: async () => {
            const uri = await takePhoto(slot);
            if (uri) await handleUpload(slot, uri);
          },
        },
        {
          text: "Choose from library",
          onPress: async () => {
            const uri = await pickFromLibrary(slot);
            if (uri) await handleUpload(slot, uri);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [pickFromLibrary, takePhoto, handleUpload]
  );

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.grid}>
        {VEHICLE_PHOTO_SLOTS.map((slot) => {
          const url = photos[slot];
          const busy = busySlot === slot;
          const done = Boolean(url);
          return (
            <TouchableOpacity
              key={slot}
              activeOpacity={0.85}
              onPress={() => onPick(slot)}
              disabled={busy}
              style={[
                styles.tile,
                {
                  backgroundColor: Colors.gray[100],
                  borderColor: done ? Colors.accent : Colors.border,
                },
              ]}
              testID={`veh-photo-${slot}`}
              accessibilityRole="button"
            >
              {url ? (
                <Image source={{ uri: url }} style={styles.tileImg} resizeMode="cover" />
              ) : (
                <View style={styles.tilePlaceholder}>
                  <View style={[styles.tileIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <Camera color={Colors.accent} size={20} />
                  </View>
                  <Text style={[styles.tileHint, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {SLOT_HINT[slot]}
                  </Text>
                </View>
              )}
              {busy ? (
                <View style={styles.tileOverlay}>
                  <ActivityIndicator color={Colors.secondary} />
                </View>
              ) : null}
              <View style={[styles.tileLabelWrap, { backgroundColor: Colors.background + "EE" }]}>
                <Text style={[styles.tileLabel, { color: Colors.text }]}>{SLOT_LABEL[slot]}</Text>
                {done ? (
                  <View style={[styles.badge, { backgroundColor: Colors.accent }]}>
                    <Check color={Colors.onAccent} size={11} />
                  </View>
                ) : (
                  <View style={[styles.badge, { backgroundColor: Colors.border }]}>
                    <ImagePlus color={Colors.textSecondary} size={11} />
                  </View>
                )}
              </View>
              {done && !busy ? (
                <View style={[styles.retake, { backgroundColor: Colors.background + "EE" }]}>
                  <RefreshCw color={Colors.text} size={12} />
                  <Text style={[styles.retakeText, { color: Colors.text }]}>Replace</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    overflow: "hidden",
    position: "relative",
  },
  tileImg: { width: "100%", height: "100%" },
  tilePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  tileHint: { fontSize: 11, textAlign: "center" },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabelWrap: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tileLabel: { fontSize: 12, fontWeight: "700" as const },
  badge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  retake: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  retakeText: { fontSize: 11, fontWeight: "700" as const },
});
