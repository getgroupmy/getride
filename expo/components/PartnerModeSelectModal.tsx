import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Image } from "react-native";
import { Car, ChevronRight, Smartphone, Briefcase, X } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export type PartnerMode = string;

export interface PartnerModeOption {
  id: string;
  name: string;
  description?: string;
  /** Public URL for a custom uploaded icon (partner-type-icons bucket). */
  iconUrl?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (mode: PartnerMode) => void;
  /** Dynamic list of partner-type options assigned to the partner.
   * When empty/undefined the legacy TEKSI + eHailing options are shown. */
  options?: PartnerModeOption[];
}

const DEFAULT_OPTIONS: PartnerModeOption[] = [
  { id: "TEKSI", name: "TEKSI", description: "Traditional taxi service" },
  { id: "eHailing", name: "eHailing", description: "On-demand ride requests" },
];

const iconFor = (name: string) => {
  const n = name.trim().toLowerCase();
  if (n === "teksi" || n.includes("taxi")) return Car;
  if (n === "ehailing" || n.includes("hail") || n.includes("ride")) return Smartphone;
  return Briefcase;
};

export default function PartnerModeSelectModal({ visible, onClose, onSelect, options }: Props) {
  const Colors = useColors();
  const list = options && options.length > 0 ? options : DEFAULT_OPTIONS;

  const handleSelect = (opt: PartnerModeOption) => {
    console.log("Selected partner mode:", opt.name);
    onSelect(opt.name);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} testID="partner-mode-overlay">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.card, { backgroundColor: Colors.secondary }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: Colors.text }]}>Select your service mode</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="partner-mode-close"
            >
              <X color={Colors.textSecondary} size={22} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            {options && options.length > 0
              ? "Choose from the services assigned to you"
              : "Choose how do you want to earn today"}
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {list.map((opt) => {
              const Icon = iconFor(opt.name);
              const hasCustomIcon = typeof opt.iconUrl === "string" && opt.iconUrl.trim().length > 0;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.option, { borderColor: Colors.border }]}
                  onPress={() => handleSelect(opt)}
                  accessibilityRole="button"
                  accessibilityLabel={opt.name}
                  testID={`mode-${opt.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <View style={[styles.iconWrap, { backgroundColor: Colors.accent + "20", overflow: "hidden" as const }]}>
                    {hasCustomIcon ? (
                      <Image source={{ uri: opt.iconUrl as string }} style={styles.iconImage} resizeMode="cover" />
                    ) : (
                      <Icon color={Colors.accentText} size={24} />
                    )}
                  </View>
                  <View style={styles.optionInfo}>
                    <Text style={[styles.optionTitle, { color: Colors.text }]} numberOfLines={1}>
                      {opt.name}
                    </Text>
                    {opt.description ? (
                      <Text style={[styles.optionDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
                        {opt.description}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronRight color={Colors.textSecondary} size={20} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
    maxHeight: "80%" as const,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 20,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  iconImage: {
    width: 44,
    height: 44,
  },
  optionInfo: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  optionDesc: {
    fontSize: 13,
  },
});
