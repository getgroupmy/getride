import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  AppWindow,
  Upload,
  Save,
  RotateCcw,
  Check,
  Trash2,
  Info,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useBranding } from "@/contexts/BrandingContext";

export default function AdminAppIconScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const branding = useBranding();
  const [icon, setIcon] = useState<string | null>(branding.appIconUri);
  const [saving, setSaving] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (branding.hydrated) setIcon(branding.appIconUri);
  }, [branding.hydrated, branding.appIconUri]);

  const pickIcon = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Photo library access is needed.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setIcon(res.assets[0].uri);
    } catch (e) {
      console.log("[admin-app-icon] pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!guard()) return;
    if (icon === branding.appIconUri) {
      Alert.alert("No changes", "Pick a new icon image first.");
      return;
    }
    setSaving(true);
    try {
      const ok = await branding.setAppIcon(icon);
      if (!ok) {
        Alert.alert("Publish failed", "Could not publish app icon to Supabase. Check your connection and try again.");
        return;
      }
      setShowSuccess(true);
    } finally {
      setSaving(false);
    }
  }, [branding, guard, icon]);

  const handleClear = useCallback(() => {
    Alert.alert("Reset icon", "Restore the default app icon for all users?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          if (!guard()) return;
          setSaving(true);
          try {
            const ok = await branding.setAppIcon(null);
            if (!ok) {
              Alert.alert("Reset failed", "Could not reset the app icon. Check your connection and try again.");
              return;
            }
            setIcon(null);
            setShowSuccess(true);
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }, [branding, guard]);

  const previewRing = { borderColor: Colors.border };
  const iconSource = icon
    ? { uri: icon }
    : require("@/assets/images/icon.png");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="app-icon-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <AppWindow color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>App Icon</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Change app icon for all users
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleClear}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="app-icon-reset"
          accessibilityRole="button"
          accessibilityLabel="Reset to the default icon"
        >
          <RotateCcw color={Colors.text} size={18} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.previewRow}>
          <View style={[styles.iconPreviewLg, previewRing]}>
            <Image source={iconSource} style={styles.iconPreviewLgImg} resizeMode="cover" />
          </View>
          <View style={styles.previewCol}>
            <View style={[styles.iconPreviewSm, previewRing]}>
              <Image source={iconSource} style={styles.iconPreviewSmImg} resizeMode="cover" />
            </View>
            <View style={[styles.iconPreviewXs, previewRing]}>
              <Image source={iconSource} style={styles.iconPreviewXsImg} resizeMode="cover" />
            </View>
          </View>
        </View>
        <Text style={[styles.caption, { color: Colors.textSecondary }]}>
          Preview at three sizes — home screen, settings list, and small chip.
        </Text>

        <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={styles.rowBetween}>
            <TouchableOpacity
              onPress={pickIcon}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
              testID="app-icon-pick"
              accessibilityRole="button"
            >
              <Upload color="#000000" size={16} />
              <Text style={styles.primaryBtnText}>{icon ? "Replace icon" : "Upload icon"}</Text>
            </TouchableOpacity>
            {icon ? (
              <TouchableOpacity
                onPress={() => setIcon(null)}
                style={[styles.ghostBtn, { borderColor: Colors.border }]}
                testID="app-icon-clear"
                accessibilityRole="button"
              >
                <Trash2 color={Colors.error} size={16} />
                <Text style={[styles.ghostBtnText, { color: Colors.error }]}>Use default</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.helper, { color: Colors.textSecondary }]}>
            Recommended: a square PNG, 1024×1024, no transparency.
          </Text>
        </View>

        <View style={[styles.noticeCard, { borderColor: Colors.border, backgroundColor: Colors.accent + "10" }]}>
          <Info color={Colors.accent} size={18} />
          <Text style={[styles.noticeText, { color: Colors.text }]}>
            Changes take effect after each user relaunches the app. They will see a
            one-time popup informing them that the app icon has been updated.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: Colors.accent, opacity: saving ? 0.6 : 1 }]}
          testID="app-icon-save"
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <>
              <Save color="#000000" size={18} />
              <Text style={styles.saveText}>Publish to all users</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showSuccess} transparent animationType="fade" onRequestClose={() => setShowSuccess(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: Colors.success + "20" }]}>
              <Check color={Colors.success} size={28} />
            </View>
            <Text style={[styles.modalTitle, { color: Colors.text }]}>App icon updated</Text>
            <Text style={[styles.modalBody, { color: Colors.textSecondary }]}>
              The new app icon has been published. Every user will see a confirmation
              popup the next time they relaunch the app{Platform.OS === "ios" ? " on iOS." : "."}
            </Text>
            <TouchableOpacity
              onPress={() => setShowSuccess(false)}
              style={[styles.modalBtn, { backgroundColor: Colors.accent }]}
              testID="app-icon-success-ok"
              accessibilityRole="button"
            >
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 48 },
  previewRow: { flexDirection: "row", gap: 16, alignItems: "center", justifyContent: "center" },
  previewCol: { gap: 12, alignItems: "center" },
  iconPreviewLg: {
    width: 160,
    height: 160,
    borderRadius: 36,
    overflow: "hidden",
    borderWidth: 1,
  },
  iconPreviewLgImg: { width: "100%", height: "100%" },
  iconPreviewSm: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
  },
  iconPreviewSmImg: { width: "100%", height: "100%" },
  iconPreviewXs: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
  },
  iconPreviewXsImg: { width: "100%", height: "100%" },
  caption: { fontSize: 12, textAlign: "center" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#000000", fontWeight: "600" as const },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  ghostBtnText: { fontWeight: "600" as const },
  helper: { fontSize: 12 },
  noticeCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  saveText: { color: "#000000", fontWeight: "700" as const, fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { fontSize: 18, fontWeight: "700" as const, textAlign: "center" },
  modalBody: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  modalBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  modalBtnText: { color: "#000000", fontWeight: "700" as const, fontSize: 14 },
});
