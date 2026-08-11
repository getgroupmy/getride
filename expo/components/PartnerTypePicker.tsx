import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import * as Haptics from "expo-haptics";
import { ChevronDown, Search, Users2, X, Check, Inbox } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  testID?: string;
  placeholder?: string;
}

const haptic = () => {
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
};

/**
 * Picks one or more partner types from the admin-managed list (admin-settings-partner-type).
 * Multi-select; options stream in live from the settings_entries realtime channel.
 */
export default function PartnerTypePicker({
  value,
  onChange,
  testID,
  placeholder = "Select partner type",
}: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const options = useMemo(() => {
    const entries = getEntries("partner-type");
    return entries
      .map((e) => ({
        id: e.id,
        name: String(e.values.name ?? ""),
        enabled: Boolean(e.values.enabled ?? true),
        isDefault: Boolean(e.values.isDefault ?? false),
      }))
      .filter((o) => o.name.trim().length > 0 && o.enabled)
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [getEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (name: string) => {
    const has = value.includes(name);
    const next = has ? value.filter((v) => v !== name) : [...value, name];
    onChange(next);
    haptic();
  };

  const selectedLabel = useMemo(() => {
    if (!value || value.length === 0) return "";
    if (value.length <= 2) return value.join(", ");
    return `${value[0]}, ${value[1]} +${value.length - 2}`;
  }, [value]);

  return (
    <>
      <TouchableOpacity
        onPress={() => {
          setOpen(true);
          haptic();
        }}
        activeOpacity={0.85}
        style={[
          styles.field,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
        testID={testID}
      >
        <Users2 color={Colors.textSecondary} size={18} />
        <Text
          style={[
            styles.fieldText,
            { color: value.length > 0 ? Colors.text : Colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {value.length > 0 ? selectedLabel : placeholder}
        </Text>
        <ChevronDown color={Colors.textSecondary} size={18} />
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: Colors.text }]}>Partner Type</Text>
                  <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
                    {value.length} selected • {options.length} option{options.length === 1 ? "" : "s"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setOpen(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID={testID ? `${testID}-close` : undefined}
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <View
                style={[
                  styles.searchWrap,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
              >
                <Search color={Colors.textSecondary} size={18} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search partner types"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.searchInput, { color: Colors.text }]}
                  autoCapitalize="none"
                  testID={testID ? `${testID}-search` : undefined}
                />
              </View>

              <ScrollView
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingVertical: 8 }}
                showsVerticalScrollIndicator={false}
              >
                {filtered.length === 0 ? (
                  <View style={styles.empty}>
                    <Inbox color={Colors.textSecondary} size={26} />
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                      No partner types found.
                    </Text>
                  </View>
                ) : (
                  filtered.map((opt) => {
                    const selected = value.includes(opt.name);
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => toggle(opt.name)}
                        activeOpacity={0.85}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={opt.name}
                        style={[
                          styles.row,
                          {
                            backgroundColor: selected
                              ? Colors.accent + "15"
                              : Colors.gray[100],
                            borderColor: selected ? Colors.accent : Colors.border,
                          },
                        ]}
                        testID={testID ? `${testID}-opt-${opt.id}` : undefined}
                      >
                        <View
                          style={[
                            styles.bullet,
                            { backgroundColor: Colors.accent + "20" },
                          ]}
                        >
                          <Users2 color={Colors.accent} size={16} />
                        </View>
                        <Text
                          style={[styles.rowText, { color: Colors.text }]}
                          numberOfLines={1}
                        >
                          {opt.name}
                        </Text>
                        {selected ? (
                          <Check color={Colors.accent} size={18} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  fieldText: { flex: 1, fontSize: 14, fontWeight: "600" as const },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "800" as const },
  subtitle: { fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 4,
  },
  bullet: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  rowText: { flex: 1, fontSize: 14, fontWeight: "700" as const },
  empty: { alignItems: "center" as const, paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 13 },
});
