import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Check } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface DistanceUnit {
  id: string;
  name: string;
}

const distanceUnits: DistanceUnit[] = [
  { id: "km", name: "Kilometres" },
  { id: "mi", name: "Miles" },
];

export default function DistancesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [selectedUnit, setSelectedUnit] = useState("km");

  const handleBack = () => {
    router.back();
  };

  const handleUnitSelect = (id: string) => {
    setSelectedUnit(id);
    console.log("Distance unit selected:", id);
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      
      <SafeAreaView style={[styles.safeArea, { backgroundColor: Colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
          >
            <ChevronLeft color={Colors.text} size={28} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>DISTANCES</Text>
        
        {distanceUnits.map((unit) => (
          <TouchableOpacity
            key={unit.id}
            style={styles.unitItem}
            onPress={() => handleUnitSelect(unit.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.unitName, { color: Colors.text }]}>
              {unit.name}
            </Text>
            {selectedUnit === unit.id && (
              <Check color="#4483e3" size={24} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  unitItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  unitName: {
    fontSize: 17,
    fontWeight: "400",
  },
});
