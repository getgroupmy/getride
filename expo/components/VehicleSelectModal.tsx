import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  X,
  Car,
  Plus,
  CheckCircle2,
  CircleDot,
  ShieldAlert,
  ChevronRight,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import type { AssignableVehicle } from "@/utils/vehicleAssignmentStore";

interface Props {
  visible: boolean;
  loading?: boolean;
  vehicles: AssignableVehicle[];
  serviceName: string;
  onClose: () => void;
  onSelect: (v: AssignableVehicle) => void;
  onViewStatus: (v: AssignableVehicle) => void;
  onAddNew: () => void;
}

const statusColor = (
  status: AssignableVehicle["statusLabel"],
  Colors: ReturnType<typeof useColors>
): string => {
  switch (status) {
    case "Available":
      return "#22c55e"; // green
    case "In use by you":
      return Colors.accent;
    case "In use":
      return "#ef4444"; // red
    case "Pending review":
      return "#f59e0b"; // amber
    case "Contact Admin":
      return "#ef4444"; // red
    case "Offline":
    default:
      return Colors.textSecondary;
  }
};

const StatusDot: React.FC<{ color: string }> = ({ color }) => (
  <View style={[dotStyles.dot, { backgroundColor: color }]} />
);

export default function VehicleSelectModal({
  visible,
  loading = false,
  vehicles,
  serviceName,
  onClose,
  onSelect,
  onViewStatus,
  onAddNew,
}: Props) {
  const Colors = useColors();

  const sorted = useMemo(() => {
    // Selectable first, then pending-review (still tappable), then locked
    // "In use" rows last; alphabetical by plate within each bucket.
    const rank = (r: AssignableVehicle): number => {
      if (r.selectable) return 0;
      if (r.statusLabel === "Pending review") return 1;
      if (r.statusLabel === "Contact Admin") return 2;
      return 3;
    };
    return [...vehicles].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.vehicle.plate.localeCompare(b.vehicle.plate);
    });
  }, [vehicles]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} testID="vehicle-select-overlay">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.card, { backgroundColor: Colors.secondary }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: Colors.text }]}>
                Select a vehicle
              </Text>
              <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
                {serviceName
                  ? `${serviceName} requires a vehicle`
                  : "Pick the vehicle you'll use"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="vehicle-select-close"
            >
              <X color={Colors.textSecondary} size={22} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={Colors.accentText} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>
                Loading your vehicles…
              </Text>
            </View>
          ) : sorted.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={[styles.emptyIcon, { backgroundColor: Colors.accent + "20" }]}>
                <Car color={Colors.accentText} size={28} />
              </View>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>
                No vehicles yet
              </Text>
              <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
                Add a vehicle to start driving with {serviceName || "this service"}.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {sorted.map((row) => {
                const v = row.vehicle;
                const color = statusColor(row.statusLabel, Colors);
                const StatusIcon =
                  row.statusLabel === "In use by you"
                    ? CheckCircle2
                    : row.statusLabel === "Pending review"
                    ? ShieldAlert
                    : CircleDot;
                const isPending = row.statusLabel === "Pending review";
                const isBlocked = row.statusLabel === "Contact Admin";
                const isIncomplete = row.statusLabel === "Incomplete";
                // Pending-review, Incomplete, and Contact-Admin rows are
                // tappable too — they open the vehicle's review-status screen
                // (or resume onboarding) instead of starting a session.
                const tappable = row.selectable || isPending || isBlocked || isIncomplete;
                const handlePress = () => {
                  if (row.selectable) onSelect(row);
                  else if (isPending || isBlocked || isIncomplete) onViewStatus(row);
                };
                const accentColor = isIncomplete
                  ? "#3b82f6"
                  : isPending
                  ? "#f59e0b"
                  : isBlocked
                  ? "#ef4444"
                  : Colors.border;
                const accentBg = isIncomplete
                  ? "#3b82f610"
                  : isPending
                  ? "#f59e0b10"
                  : isBlocked
                  ? "#ef444410"
                  : Colors.border + "30";
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.option,
                      {
                        borderColor: row.selectable
                          ? Colors.border
                          : accentColor + (isPending || isBlocked || isIncomplete ? "55" : ""),
                        backgroundColor: row.selectable
                          ? "transparent"
                          : accentBg,
                        opacity: tappable ? 1 : 0.7,
                      },
                    ]}
                    onPress={handlePress}
                    disabled={!tappable}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !tappable }}
                    accessibilityLabel={`${v.plate}, ${row.statusLabel}`}
                    testID={`vehicle-${v.plate}`}
                  >
                    <View
                      style={[
                        styles.iconWrap,
                        { backgroundColor: Colors.accent + "20" },
                      ]}
                    >
                      <Car color={Colors.accentText} size={22} />
                    </View>
                    <View style={styles.optionInfo}>
                    {/* StatusIcon kept for parity but unused in row layout */}
                    {null}
                      <View style={styles.plateRow}>
                        <Text
                          style={[styles.plate, { color: Colors.text }]}
                          numberOfLines={1}
                        >
                          {v.plate || "—"}
                        </Text>
                        <View style={styles.statusPill}>
                          <StatusDot color={color} />
                          <Text style={[styles.statusText, { color }]}>
                            {row.statusLabel}
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={[styles.makeModel, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {[v.make, v.model].filter(Boolean).join(" ") || "Unknown make/model"}
                        {v.color ? `  ·  ${v.color}` : ""}
                      </Text>
                      <Text
                        style={[styles.roleText, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {row.role === "owner" ? "Owner" : row.role === "co-driver" ? "Co-driver" : "Driver"}
                        {isIncomplete
                          ? "  \u00b7  Tap to resume setup"
                          : isPending || isBlocked
                          ? "  \u00b7  Tap to view status"
                          : ""}
                      </Text>
                    </View>
                    {isPending || isBlocked || isIncomplete ? (
                      <ChevronRight color={accentColor} size={18} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[styles.addBtn, { borderColor: Colors.accent }]}
            onPress={onAddNew}
            accessibilityRole="button"
            accessibilityLabel="Add a new vehicle"
            testID="vehicle-add-new"
          >
            <Plus color={Colors.accentText} size={18} />
            <Text style={[styles.addBtnText, { color: Colors.accentText }]}>
              Add a new vehicle
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const dotStyles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
});

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
    maxHeight: "82%" as const,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    marginTop: 14,
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 4,
  },
  loading: {
    paddingVertical: 32,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyWrap: {
    paddingVertical: 28,
    alignItems: "center",
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  emptyDesc: {
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  optionInfo: {
    flex: 1,
  },
  plateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  plate: {
    fontSize: 16,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
    flex: 1,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  makeModel: {
    fontSize: 13,
    marginTop: 2,
  },
  roleText: {
    fontSize: 11,
    marginTop: 2,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  addBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
});
