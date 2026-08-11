import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
} from "react-native";
import { Country, State, City } from "country-state-city";
import { Check, ChevronDown, Globe, MapPin, Building2, X, Search } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";

/**
 * Encoded keys to avoid name collisions across countries/states.
 * - countries: country name
 * - states: `${country}|${state}`
 * - cities: `${country}|${state}|${city}`
 */
export interface ServiceAreaValue {
  countries: string[];
  states: string[];
  cities: string[];
}

interface Props {
  value: ServiceAreaValue;
  onChange: (next: ServiceAreaValue) => void;
  testID?: string;
}

const CSC_KEY = "country-states-cities" as const;

export default function ServiceAreaPicker({ value, onChange, testID }: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const cscEntries = getEntries(CSC_KEY);

  const [open, setOpen] = useState<null | "country" | "state" | "city">(null);
  const [query, setQuery] = useState<string>("");

  const worldCountries = useMemo(() => Country.getAllCountries(), []);
  const countryByName = useMemo(() => {
    const m = new Map<string, { name: string; isoCode: string }>();
    worldCountries.forEach((c) => m.set(c.name, { name: c.name, isoCode: c.isoCode }));
    return m;
  }, [worldCountries]);

  // Custom countries/states/cities from admin-settings-country-states-cities entries
  const customCountries = useMemo(() => {
    const set = new Set<string>();
    cscEntries.forEach((e) => {
      const c = String(e.values.country ?? "").trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [cscEntries]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    worldCountries.forEach((c) => set.add(c.name));
    customCountries.forEach((c) => set.add(c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [worldCountries, customCountries]);

  const stateOptions = useMemo(() => {
    // states for each selected country
    const out: { country: string; state: string; key: string }[] = [];
    const seen = new Set<string>();
    value.countries.forEach((cn) => {
      const c = countryByName.get(cn);
      if (c) {
        State.getStatesOfCountry(c.isoCode).forEach((s) => {
          const key = `${cn}|${s.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ country: cn, state: s.name, key });
          }
        });
      }
      // custom states from entries
      cscEntries.forEach((e) => {
        const ec = String(e.values.country ?? "").trim();
        const es = String(e.values.state ?? "").trim();
        if (!es) return;
        if (ec.toLowerCase() !== cn.toLowerCase()) return;
        const key = `${cn}|${es}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ country: cn, state: es, key });
        }
      });
    });
    return out.sort((a, b) => a.country.localeCompare(b.country) || a.state.localeCompare(b.state));
  }, [value.countries, countryByName, cscEntries]);

  const cityOptions = useMemo(() => {
    const out: { country: string; state: string; city: string; key: string }[] = [];
    const seen = new Set<string>();
    value.states.forEach((stKey) => {
      const [cn, sn] = stKey.split("|");
      if (!cn || !sn) return;
      const c = countryByName.get(cn);
      if (c) {
        const st = State.getStatesOfCountry(c.isoCode).find((s) => s.name === sn);
        if (st) {
          City.getCitiesOfState(c.isoCode, st.isoCode).forEach((ci) => {
            const key = `${cn}|${sn}|${ci.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ country: cn, state: sn, city: ci.name, key });
            }
          });
        }
      }
      cscEntries.forEach((e) => {
        const ec = String(e.values.country ?? "").trim();
        const es = String(e.values.state ?? "").trim();
        const eci = String(e.values.city ?? "").trim();
        if (!eci) return;
        if (ec.toLowerCase() !== cn.toLowerCase() || es.toLowerCase() !== sn.toLowerCase()) return;
        const key = `${cn}|${sn}|${eci}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ country: cn, state: sn, city: eci, key });
        }
      });
    });
    return out.sort(
      (a, b) =>
        a.country.localeCompare(b.country) ||
        a.state.localeCompare(b.state) ||
        a.city.localeCompare(b.city)
    );
  }, [value.states, countryByName, cscEntries]);

  const toggleCountry = (cn: string) => {
    const has = value.countries.includes(cn);
    const nextCountries = has ? value.countries.filter((x) => x !== cn) : [...value.countries, cn];
    // prune states/cities not belonging to selected countries
    const nextStates = value.states.filter((sk) => {
      const [c] = sk.split("|");
      return nextCountries.includes(c);
    });
    const nextCities = value.cities.filter((ck) => {
      const [c, s] = ck.split("|");
      return nextCountries.includes(c) && nextStates.includes(`${c}|${s}`);
    });
    onChange({ countries: nextCountries, states: nextStates, cities: nextCities });
  };

  const toggleState = (key: string) => {
    const has = value.states.includes(key);
    const nextStates = has ? value.states.filter((x) => x !== key) : [...value.states, key];
    const nextCities = value.cities.filter((ck) => {
      const [c, s] = ck.split("|");
      return nextStates.includes(`${c}|${s}`);
    });
    onChange({ ...value, states: nextStates, cities: nextCities });
  };

  const toggleCity = (key: string) => {
    const has = value.cities.includes(key);
    const next = has ? value.cities.filter((x) => x !== key) : [...value.cities, key];
    onChange({ ...value, cities: next });
  };

  const closeModal = () => {
    setOpen(null);
    setQuery("");
  };

  const renderRow = (label: string, sub: string | null, selected: boolean, onPress: () => void, key: string) => (
    <TouchableOpacity
      key={key}
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.pickerRow,
        { backgroundColor: Colors.gray[100], borderColor: selected ? Colors.accent : Colors.border },
      ]}
      testID={`service-area-row-${key}`}
      accessibilityRole="button"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickerRowText, { color: Colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        {sub && (
          <Text style={[styles.pickerRowSub, { color: Colors.textSecondary }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: selected ? Colors.accent : "transparent",
            borderColor: selected ? Colors.accent : Colors.border,
          },
        ]}
      >
        {selected && <Check color={Colors.onAccent} size={14} />}
      </View>
    </TouchableOpacity>
  );

  const q = query.trim().toLowerCase();

  const filteredCountries = useMemo(
    () => (q ? countryOptions.filter((c) => c.toLowerCase().includes(q)) : countryOptions),
    [countryOptions, q]
  );
  const filteredStates = useMemo(
    () =>
      q
        ? stateOptions.filter(
            (s) => s.state.toLowerCase().includes(q) || s.country.toLowerCase().includes(q)
          )
        : stateOptions,
    [stateOptions, q]
  );
  const filteredCities = useMemo(
    () =>
      q
        ? cityOptions.filter(
            (c) =>
              c.city.toLowerCase().includes(q) ||
              c.state.toLowerCase().includes(q) ||
              c.country.toLowerCase().includes(q)
          )
        : cityOptions,
    [cityOptions, q]
  );

  const summary = (icon: React.ReactNode, label: string, count: number, disabled: boolean, onPress: () => void, tid: string) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        styles.summaryRow,
        {
          backgroundColor: Colors.gray[100],
          borderColor: Colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={tid}
      accessibilityRole="button"
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[styles.summaryLabel, { color: Colors.text }]}>{label}</Text>
        <Text style={[styles.summaryCount, { color: Colors.textSecondary }]}>
          {count === 0 ? "None selected" : `${count} selected`}
        </Text>
      </View>
      <ChevronDown color={Colors.textSecondary} size={18} />
    </TouchableOpacity>
  );

  return (
    <View testID={testID}>
      {summary(
        <Globe color={Colors.accentText} size={18} />,
        "Countries",
        value.countries.length,
        false,
        () => setOpen("country"),
        "service-area-open-country"
      )}
      {summary(
        <MapPin color={Colors.accentText} size={18} />,
        "States",
        value.states.length,
        value.countries.length === 0,
        () => setOpen("state"),
        "service-area-open-state"
      )}
      {summary(
        <Building2 color={Colors.accentText} size={18} />,
        "Cities",
        value.cities.length,
        value.states.length === 0,
        () => setOpen("city"),
        "service-area-open-city"
      )}

      {/* Selected chips preview */}
      {(value.countries.length > 0 || value.states.length > 0 || value.cities.length > 0) && (
        <View style={styles.chipsWrap}>
          {value.countries.map((c) => (
            <View key={`c-${c}`} style={[styles.chip, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
              <Globe color={Colors.accentText} size={11} />
              <Text style={[styles.chipText, { color: Colors.accentText }]} numberOfLines={1}>{c}</Text>
              <TouchableOpacity onPress={() => toggleCountry(c)} testID={`chip-remove-country-${c}`} accessibilityRole="button">
                <X color={Colors.accentText} size={12} />
              </TouchableOpacity>
            </View>
          ))}
          {value.states.map((sk) => {
            const [, sn] = sk.split("|");
            return (
              <View key={`s-${sk}`} style={[styles.chip, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <MapPin color={Colors.textSecondary} size={11} />
                <Text style={[styles.chipText, { color: Colors.text }]} numberOfLines={1}>{sn}</Text>
                <TouchableOpacity onPress={() => toggleState(sk)} testID={`chip-remove-state-${sk}`} accessibilityRole="button">
                  <X color={Colors.textSecondary} size={12} />
                </TouchableOpacity>
              </View>
            );
          })}
          {value.cities.map((ck) => {
            const parts = ck.split("|");
            const ci = parts[2] ?? "";
            return (
              <View key={`ci-${ck}`} style={[styles.chip, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Building2 color={Colors.textSecondary} size={11} />
                <Text style={[styles.chipText, { color: Colors.text }]} numberOfLines={1}>{ci}</Text>
                <TouchableOpacity onPress={() => toggleCity(ck)} testID={`chip-remove-city-${ck}`} accessibilityRole="button">
                  <X color={Colors.textSecondary} size={12} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={open !== null} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={[styles.modalBackdrop, { backgroundColor: "rgba(0,0,0,0.4)" }]}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={[styles.modalHeader, { borderBottomColor: Colors.border }]}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>
                {open === "country" ? "Select countries" : open === "state" ? "Select states" : "Select cities"}
              </Text>
              <TouchableOpacity onPress={closeModal} style={[styles.modalClose, { backgroundColor: Colors.gray[100] }]} testID="service-area-close" accessibilityRole="button">
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Search color={Colors.textSecondary} size={16} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                autoCapitalize="none"
                autoCorrect={false}
                testID="service-area-search"
                accessibilityLabel="Search…"
              />
            </View>

            {open === "country" && (
              <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item}
                renderItem={({ item }) =>
                  renderRow(item, null, value.countries.includes(item), () => toggleCountry(item), `c-${item}`)
                }
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              />
            )}
            {open === "state" && (
              <FlatList
                data={filteredStates}
                keyExtractor={(item) => item.key}
                renderItem={({ item }) =>
                  renderRow(item.state, item.country, value.states.includes(item.key), () => toggleState(item.key), `s-${item.key}`)
                }
                ListEmptyComponent={
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                    Select at least one country first.
                  </Text>
                }
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              />
            )}
            {open === "city" && (
              <FlatList
                data={filteredCities}
                keyExtractor={(item) => item.key}
                renderItem={({ item }) =>
                  renderRow(
                    item.city,
                    `${item.state}, ${item.country}`,
                    value.cities.includes(item.key),
                    () => toggleCity(item.key),
                    `ci-${item.key}`
                  )
                }
                ListEmptyComponent={
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                    Select at least one state first.
                  </Text>
                }
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              />
            )}

            <TouchableOpacity
              onPress={closeModal}
              style={[styles.doneBtn, { backgroundColor: Colors.accent }]}
              activeOpacity={0.9}
              testID="service-area-done"
              accessibilityRole="button"
            >
              <Text style={[styles.doneText, { color: Colors.onAccent }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  summaryLabel: { fontSize: 13, fontWeight: "700" as const },
  summaryCount: { fontSize: 11, marginTop: 2 },
  chipsWrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 4, marginBottom: 8 },
  chip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipText: { fontSize: 11, fontWeight: "700" as const, maxWidth: 160 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end" as const },
  modalCard: {
    height: "85%" as const,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingBottom: 10,
    borderBottomWidth: 1,
    marginBottom: 10,
  },
  modalTitle: { fontSize: 16, fontWeight: "800" as const },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 13 },
  listContent: { paddingBottom: 12, gap: 6 },
  pickerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  pickerRowText: { fontSize: 13, fontWeight: "700" as const },
  pickerRowSub: { fontSize: 11, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  doneBtn: {
    height: 46,
    borderRadius: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginTop: 8,
  },
  doneText: { fontSize: 14, fontWeight: "800" as const },
  emptyText: { fontSize: 12, textAlign: "center" as const, marginTop: 24 },
});
