import React, { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Check } from "lucide-react-native";
import { MODAL_SUPPORTED_ORIENTATIONS } from "@/utils/modalOrientation";
import { useColors } from "@/hooks/useColors";
import { useBranding } from "@/contexts/BrandingContext";

/**
 * One-time popup informing the user the admin updated the app icon.
 * Shown after relaunch when `iconChangedAt` differs from `iconAckAt`.
 */
export function AppIconChangeModal() {
  const Colors = useColors();
  const { hydrated, hasUnacknowledgedIconChange, appIconUri, acknowledgeIconChange } = useBranding();
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    if (hydrated && hasUnacknowledgedIconChange) {
      setVisible(true);
    }
  }, [hydrated, hasUnacknowledgedIconChange]);

  const onClose = async () => {
    setVisible(false);
    await acknowledgeIconChange();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
          <View style={[styles.iconWrap, { borderColor: Colors.border }]}>
            <Image
              source={appIconUri ? { uri: appIconUri } : require("@/assets/images/icon.png")}
              style={styles.icon}
              resizeMode="cover"
            />
          </View>
          <View style={[styles.checkBadge, { backgroundColor: Colors.success }]}>
            <Check color="#fff" size={16} />
          </View>
          <Text style={[styles.title, { color: Colors.text }]}>App icon updated</Text>
          <Text style={[styles.body, { color: Colors.textSecondary }]}>
            The app icon has been refreshed by the team. Enjoy the new look!
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.btn, { backgroundColor: Colors.accent }]}
            testID="app-icon-change-ok"
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
  },
  icon: { width: "100%", height: "100%" },
  checkBadge: {
    position: "absolute",
    top: 24 + 96 - 14,
    right: "50%",
    marginRight: -54,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700" as const, marginTop: 6 },
  body: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  btn: {
    marginTop: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  btnText: { color: "#000000", fontWeight: "700" as const, fontSize: 14 },
});
