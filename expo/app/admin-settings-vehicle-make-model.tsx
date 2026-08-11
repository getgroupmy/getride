import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Inbox,
  Save,
  Car,
  ImageIcon,
  Upload,
  ChevronRight,
  Fuel,
  Factory,
  Tag,
  Home as HomeIcon,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAdminData, VehicleMakeModelRecord } from "@/contexts/AdminDataContext";

type Level = 0 | 1 | 2 | 3;

interface Path {
  vehicleType?: string;
  energyType?: string;
  make?: string;
}

interface ModelForm {
  vehicleType: string;
  energyType: string;
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string; // empty means ongoing (~)
  ongoing: boolean;
  iconUri: string;
  status: boolean;
}

const emptyModel = (path: Path): ModelForm => ({
  vehicleType: path.vehicleType ?? "",
  energyType: path.energyType ?? "",
  make: path.make ?? "",
  model: "",
  yearFrom: "",
  yearTo: "",
  ongoing: false,
  iconUri: "",
  status: true,
});

const readEntry = (e: VehicleMakeModelRecord) => ({
  id: e.id,
  vehicleType: (e.vehicleType ?? "").trim(),
  energyType: (e.energyType ?? "").trim(),
  make: (e.make ?? "").trim(),
  model: (e.model ?? "").trim(),
  yearFrom: (e.yearFrom ?? "").trim(),
  yearTo: (e.yearTo ?? "").trim(),
  iconUri: e.iconUri ?? "",
  status: e.status === undefined ? true : Boolean(e.status),
  isDefault: Boolean(e.isDefault),
});

type ParsedEntry = ReturnType<typeof readEntry>;

const formatYearRange = (from: string, to: string): string => {
  const f = from.trim();
  const t = to.trim();
  if (!f && !t) return "";
  if (f && !t) return `(${f} ~)`;
  if (!f && t) return `(~ ${t})`;
  return `(${f} - ${t})`;
};

export default function AdminSettingsVehicleMakeModelScreen() {
  const router = useRouter();
  const Colors = useColors();
  const {
    vehicleMakeModels,
    addVehicleMakeModel,
    updateVehicleMakeModel,
    removeVehicleMakeModel,
  } = useAdminData();
  const entries = vehicleMakeModels;

  const parsed: ParsedEntry[] = useMemo(() => entries.map(readEntry), [entries]);

  const [path, setPath] = useState<Path>({});
  const [query, setQuery] = useState<string>("");

  const level: Level = (path.make
    ? 3
    : path.energyType
    ? 2
    : path.vehicleType
    ? 1
    : 0) as Level;

  // ---------- Modal state ----------
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<"category" | "model">("category");
  const [categoryLevel, setCategoryLevel] = useState<Level>(0);
  const [categoryName, setCategoryName] = useState<string>("");
  const [categoryRenameFrom, setCategoryRenameFrom] = useState<string>("");
  const [categoryParents, setCategoryParents] = useState<Path>({});
  const [editingModelEntry, setEditingModelEntry] = useState<VehicleMakeModelRecord | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModel({}));
  const [addPickerOpen, setAddPickerOpen] = useState<boolean>(false);

  // ---------- Derived lists per level ----------
  const vehicleTypes = useMemo(() => {
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (!p.vehicleType) return;
      set.set(p.vehicleType, (set.get(p.vehicleType) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed]);

  const energyTypes = useMemo(() => {
    if (!path.vehicleType) return [];
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (p.vehicleType !== path.vehicleType) return;
      if (!p.energyType) return;
      set.set(p.energyType, (set.get(p.energyType) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed, path.vehicleType]);

  const makes = useMemo(() => {
    if (!path.vehicleType || !path.energyType) return [];
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (p.vehicleType !== path.vehicleType) return;
      if (p.energyType !== path.energyType) return;
      if (!p.make) return;
      set.set(p.make, (set.get(p.make) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed, path.vehicleType, path.energyType]);

  const models = useMemo(() => {
    if (!path.vehicleType || !path.energyType || !path.make) return [];
    return parsed
      .filter(
        (p) =>
          p.vehicleType === path.vehicleType &&
          p.energyType === path.energyType &&
          p.make === path.make &&
          p.model
      )
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [parsed, path]);

  // ---------- Filter by query (deep search across hierarchy) ----------
  const matchesEntryDeep = useCallback(
    (p: ParsedEntry, q: string): boolean => {
      if (!q) return true;
      return (
        p.vehicleType.toLowerCase().includes(q) ||
        p.energyType.toLowerCase().includes(q) ||
        p.make.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.yearFrom.toLowerCase().includes(q) ||
        p.yearTo.toLowerCase().includes(q) ||
        formatYearRange(p.yearFrom, p.yearTo).toLowerCase().includes(q)
      );
    },
    []
  );

  const filteredVehicleTypes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicleTypes;
    const allowed = new Set<string>();
    parsed.forEach((p) => {
      if (!p.vehicleType) return;
      if (
        p.vehicleType.toLowerCase().includes(q) ||
        matchesEntryDeep(p, q)
      ) {
        allowed.add(p.vehicleType);
      }
    });
    return vehicleTypes.filter((v) => allowed.has(v.name));
  }, [vehicleTypes, parsed, query, matchesEntryDeep]);

  const filteredEnergyTypes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return energyTypes;
    const allowed = new Set<string>();
    parsed.forEach((p) => {
      if (p.vehicleType !== path.vehicleType) return;
      if (!p.energyType) return;
      if (
        p.energyType.toLowerCase().includes(q) ||
        p.make.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.yearFrom.toLowerCase().includes(q) ||
        p.yearTo.toLowerCase().includes(q) ||
        formatYearRange(p.yearFrom, p.yearTo).toLowerCase().includes(q)
      ) {
        allowed.add(p.energyType);
      }
    });
    return energyTypes.filter((v) => allowed.has(v.name));
  }, [energyTypes, parsed, path.vehicleType, query]);

  const filteredMakes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return makes;
    const allowed = new Set<string>();
    parsed.forEach((p) => {
      if (p.vehicleType !== path.vehicleType) return;
      if (p.energyType !== path.energyType) return;
      if (!p.make) return;
      if (
        p.make.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.yearFrom.toLowerCase().includes(q) ||
        p.yearTo.toLowerCase().includes(q) ||
        formatYearRange(p.yearFrom, p.yearTo).toLowerCase().includes(q)
      ) {
        allowed.add(p.make);
      }
    });
    return makes.filter((v) => allowed.has(v.name));
  }, [makes, parsed, path.vehicleType, path.energyType, query]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.model.toLowerCase().includes(q) ||
        m.yearFrom.toLowerCase().includes(q) ||
        m.yearTo.toLowerCase().includes(q) ||
        formatYearRange(m.yearFrom, m.yearTo).toLowerCase().includes(q)
    );
  }, [models, query]);

  // Global model search: when there is a query, find matching models anywhere
  // in the catalog, scoped softly to the current path (only filters by fields
  // that the user has actively drilled into).
  const globalModelMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as ParsedEntry[];
    return parsed
      .filter((p) => {
        if (!p.model) return false;
        if (path.vehicleType && p.vehicleType !== path.vehicleType) return false;
        if (path.energyType && p.energyType !== path.energyType) return false;
        if (path.make && p.make !== path.make) return false;
        return (
          p.model.toLowerCase().includes(q) ||
          p.make.toLowerCase().includes(q) ||
          p.energyType.toLowerCase().includes(q) ||
          p.vehicleType.toLowerCase().includes(q) ||
          p.yearFrom.toLowerCase().includes(q) ||
          p.yearTo.toLowerCase().includes(q) ||
          formatYearRange(p.yearFrom, p.yearTo).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [parsed, query, path.vehicleType, path.energyType, path.make]);

  // ---------- Navigation helpers ----------
  const haptic = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  const goTo = useCallback(
    (next: Path) => {
      haptic();
      setQuery("");
      setPath(next);
    },
    [haptic]
  );

  const breadcrumbs = useMemo(() => {
    const items: { id: string; label: string; onPress?: () => void }[] = [
      { id: "root", label: "Vehicle Types", onPress: () => goTo({}) },
    ];
    if (path.vehicleType) {
      items.push({
        id: "vt",
        label: path.vehicleType,
        onPress: () => goTo({ vehicleType: path.vehicleType }),
      });
    }
    if (path.energyType) {
      items.push({
        id: "et",
        label: path.energyType,
        onPress: () =>
          goTo({ vehicleType: path.vehicleType, energyType: path.energyType }),
      });
    }
    if (path.make) {
      items.push({ id: "mk", label: path.make });
    }
    return items;
  }, [path, goTo]);

  // ---------- Add / Edit category ----------
  const openAddCategory = (lvl: Level) => {
    setModalMode("category");
    setCategoryLevel(lvl);
    setCategoryName("");
    setCategoryRenameFrom("");
    setCategoryParents({
      vehicleType: path.vehicleType,
      energyType: path.energyType,
      make: path.make,
    });
    setModalOpen(true);
  };

  const openRenameCategory = (lvl: Level, current: string) => {
    setModalMode("category");
    setCategoryLevel(lvl);
    setCategoryName(current);
    setCategoryRenameFrom(current);
    setCategoryParents({
      vehicleType: path.vehicleType,
      energyType: path.energyType,
      make: path.make,
    });
    setModalOpen(true);
  };

  const saveCategory = () => {
    const name = categoryName.trim();
    if (!name) {
      Alert.alert("Missing field", "Please enter a name.");
      return;
    }
    const parentVT = (categoryParents.vehicleType ?? "").trim();
    const parentET = (categoryParents.energyType ?? "").trim();
    if (categoryLevel >= 1 && !parentVT) {
      Alert.alert("Missing field", "Please select or enter a Vehicle Type.");
      return;
    }
    if (categoryLevel >= 2 && !parentET) {
      Alert.alert("Missing field", "Please select or enter an Energy Type.");
      return;
    }

    if (!categoryRenameFrom) {
      const dup = parsed.some((p) => {
        if (categoryLevel === 0) return norm(p.vehicleType) === norm(name);
        if (categoryLevel === 1)
          return (
            norm(p.vehicleType) === norm(parentVT) &&
            norm(p.energyType) === norm(name)
          );
        if (categoryLevel === 2)
          return (
            norm(p.vehicleType) === norm(parentVT) &&
            norm(p.energyType) === norm(parentET) &&
            norm(p.make) === norm(name)
          );
        return false;
      });
      if (dup) {
        Alert.alert(
          "Already exists",
          `"${name}" already exists. Tap it from the suggestions to open the existing one.`
        );
        return;
      }
    }
    if (categoryRenameFrom) {
      if (norm(categoryRenameFrom) !== norm(name)) {
        const dup = parsed.some((p) => {
          if (categoryLevel === 0) return norm(p.vehicleType) === norm(name);
          if (categoryLevel === 1)
            return (
              norm(p.vehicleType) === norm(path.vehicleType ?? "") &&
              norm(p.energyType) === norm(name)
            );
          if (categoryLevel === 2)
            return (
              norm(p.vehicleType) === norm(path.vehicleType ?? "") &&
              norm(p.energyType) === norm(path.energyType ?? "") &&
              norm(p.make) === norm(name)
            );
          return false;
        });
        if (dup) {
          Alert.alert(
            "Already exists",
            `"${name}" already exists at this level.`
          );
          return;
        }
      }
      // Rename: update all entries that match current path + the field at this level
      const targetEntries = entries.filter((e) => {
        const p = readEntry(e);
        if (categoryLevel === 0) return p.vehicleType === categoryRenameFrom;
        if (categoryLevel === 1)
          return (
            p.vehicleType === path.vehicleType && p.energyType === categoryRenameFrom
          );
        if (categoryLevel === 2)
          return (
            p.vehicleType === path.vehicleType &&
            p.energyType === path.energyType &&
            p.make === categoryRenameFrom
          );
        return false;
      });
      targetEntries.forEach((e) => {
        const patch: Partial<VehicleMakeModelRecord> = {};
        if (categoryLevel === 0) patch.vehicleType = name;
        if (categoryLevel === 1) patch.energyType = name;
        if (categoryLevel === 2) patch.make = name;
        updateVehicleMakeModel(e.id, patch);
      });
      // Update current path label if user renamed the active branch
      setPath((cur) => {
        const c = { ...cur };
        if (categoryLevel === 0 && c.vehicleType === categoryRenameFrom)
          c.vehicleType = name;
        if (categoryLevel === 1 && c.energyType === categoryRenameFrom)
          c.energyType = name;
        if (categoryLevel === 2 && c.make === categoryRenameFrom) c.make = name;
        return c;
      });
    } else {
      // Add: create a placeholder entry holding just the new category info
      addVehicleMakeModel({
        vehicleType: categoryLevel === 0 ? name : parentVT,
        energyType: categoryLevel === 1 ? name : parentET,
        make: categoryLevel === 2 ? name : "",
        model: "",
        yearFrom: "",
        yearTo: "",
        iconUri: "",
        status: true,
        isDefault: false,
      });
    }
    setModalOpen(false);
  };

  const deleteCategory = (lvl: Level, name: string) => {
    const label =
      lvl === 0 ? "vehicle type" : lvl === 1 ? "energy type" : "make";
    Alert.alert(
      `Delete ${label}`,
      `Remove "${name}" and all entries under it?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            entries.forEach((e) => {
              const p = readEntry(e);
              const matches =
                (lvl === 0 && p.vehicleType === name) ||
                (lvl === 1 &&
                  p.vehicleType === path.vehicleType &&
                  p.energyType === name) ||
                (lvl === 2 &&
                  p.vehicleType === path.vehicleType &&
                  p.energyType === path.energyType &&
                  p.make === name);
              if (matches) removeVehicleMakeModel(e.id);
            });
          },
        },
      ]
    );
  };

  // ---------- Add / Edit model ----------
  const openAddModel = () => {
    setModalMode("model");
    setEditingModelEntry(null);
    setModelForm(emptyModel(path));
    setModalOpen(true);
  };

  const openAddPicker = () => {
    haptic();
    setAddPickerOpen(true);
  };

  const handleAddPicker = (kind: "vt" | "et" | "make" | "model") => {
    setAddPickerOpen(false);
    if (kind === "model") {
      openAddModel();
    } else if (kind === "vt") {
      openAddCategory(0);
    } else if (kind === "et") {
      openAddCategory(1);
    } else {
      openAddCategory(2);
    }
  };

  // Energy types & makes available for parent selection inside category modal
  const allEnergyTypesForVT = useMemo(() => {
    const vt = (categoryParents.vehicleType ?? "").trim();
    if (!vt) return [] as string[];
    const set = new Set<string>();
    parsed.forEach((p) => {
      if (p.vehicleType === vt && p.energyType) set.add(p.energyType);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parsed, categoryParents.vehicleType]);

  const allMakesForVTET = useMemo(() => {
    const vt = (categoryParents.vehicleType ?? "").trim();
    const et = (categoryParents.energyType ?? "").trim();
    if (!vt || !et) return [] as string[];
    const set = new Set<string>();
    parsed.forEach((p) => {
      if (p.vehicleType === vt && p.energyType === et && p.make) set.add(p.make);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parsed, categoryParents.vehicleType, categoryParents.energyType]);

  const norm = useCallback((s: string) => s.trim().toLowerCase(), []);

  // Live suggestions for the current category-modal level filtered by typed name
  const categoryNameSuggestions = useMemo(() => {
    const q = norm(categoryName);
    let pool: string[] = [];
    if (categoryLevel === 0) pool = vehicleTypes.map((v) => v.name);
    else if (categoryLevel === 1) pool = allEnergyTypesForVT;
    else if (categoryLevel === 2) pool = allMakesForVTET;
    if (!q) return pool.slice(0, 12);
    return pool.filter((n) => norm(n).includes(q)).slice(0, 12);
  }, [categoryLevel, categoryName, vehicleTypes, allEnergyTypesForVT, allMakesForVTET, norm]);

  const pickExistingCategory = useCallback(
    (name: string) => {
      const vt = (categoryParents.vehicleType ?? "").trim();
      const et = (categoryParents.energyType ?? "").trim();
      setModalOpen(false);
      setQuery("");
      if (categoryLevel === 0) setPath({ vehicleType: name });
      else if (categoryLevel === 1) setPath({ vehicleType: vt, energyType: name });
      else if (categoryLevel === 2)
        setPath({ vehicleType: vt, energyType: et, make: name });
    },
    [categoryLevel, categoryParents.vehicleType, categoryParents.energyType]
  );

  // ---------- Model form suggestions ----------
  const modelEnergySuggestions = useMemo(() => {
    const vt = norm(modelForm.vehicleType);
    if (!vt) return [] as string[];
    const q = norm(modelForm.energyType);
    const set = new Set<string>();
    parsed.forEach((p) => {
      if (norm(p.vehicleType) === vt && p.energyType) set.add(p.energyType);
    });
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return (q ? arr.filter((n) => norm(n).includes(q)) : arr).slice(0, 12);
  }, [parsed, modelForm.vehicleType, modelForm.energyType, norm]);

  const modelMakeSuggestions = useMemo(() => {
    const vt = norm(modelForm.vehicleType);
    const et = norm(modelForm.energyType);
    if (!vt || !et) return [] as string[];
    const q = norm(modelForm.make);
    const set = new Set<string>();
    parsed.forEach((p) => {
      if (norm(p.vehicleType) === vt && norm(p.energyType) === et && p.make)
        set.add(p.make);
    });
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return (q ? arr.filter((n) => norm(n).includes(q)) : arr).slice(0, 12);
  }, [parsed, modelForm.vehicleType, modelForm.energyType, modelForm.make, norm]);

  const modelNameSuggestions = useMemo(() => {
    const vt = norm(modelForm.vehicleType);
    const et = norm(modelForm.energyType);
    const mk = norm(modelForm.make);
    if (!vt || !et || !mk) return [] as ParsedEntry[];
    const q = norm(modelForm.model);
    const list = parsed.filter(
      (p) =>
        norm(p.vehicleType) === vt &&
        norm(p.energyType) === et &&
        norm(p.make) === mk &&
        p.model
    );
    const filtered = q
      ? list.filter((p) => norm(p.model).includes(q))
      : list;
    return filtered
      .sort((a, b) => a.model.localeCompare(b.model))
      .slice(0, 12);
  }, [parsed, modelForm.vehicleType, modelForm.energyType, modelForm.make, modelForm.model, norm]);

  const openEditModel = (entry: VehicleMakeModelRecord) => {
    const p = readEntry(entry);
    setModalMode("model");
    setEditingModelEntry(entry);
    setModelForm({
      vehicleType: p.vehicleType,
      energyType: p.energyType,
      make: p.make,
      model: p.model,
      yearFrom: p.yearFrom,
      yearTo: p.yearTo === "~" ? "" : p.yearTo,
      ongoing: p.yearTo === "~",
      iconUri: p.iconUri,
      status: p.status,
    });
    setModalOpen(true);
  };

  const saveModel = () => {
    const f = modelForm;
    if (!f.vehicleType.trim()) {
      Alert.alert("Missing field", "Please fill in Vehicle Type.");
      return;
    }
    if (!f.energyType.trim()) {
      Alert.alert("Missing field", "Please fill in Energy Type.");
      return;
    }
    if (!f.make.trim()) {
      Alert.alert("Missing field", "Please fill in Make.");
      return;
    }
    if (!f.model.trim()) {
      Alert.alert("Missing field", "Please fill in Model.");
      return;
    }
    const yearTo = f.ongoing ? "~" : f.yearTo.trim();
    const dup = parsed.find(
      (p) =>
        (!editingModelEntry || p.id !== editingModelEntry.id) &&
        norm(p.vehicleType) === norm(f.vehicleType) &&
        norm(p.energyType) === norm(f.energyType) &&
        norm(p.make) === norm(f.make) &&
        norm(p.model) === norm(f.model) &&
        p.yearFrom.trim() === f.yearFrom.trim() &&
        p.yearTo.trim() === yearTo
    );
    if (dup) {
      Alert.alert(
        "Already exists",
        `"${f.model.trim()}" already exists for ${f.make.trim()} (${f.energyType.trim()} \u00b7 ${f.vehicleType.trim()}). Tap it from the suggestions to edit the existing one.`
      );
      return;
    }
    const payload = {
      vehicleType: f.vehicleType.trim(),
      energyType: f.energyType.trim(),
      make: f.make.trim(),
      model: f.model.trim(),
      yearFrom: f.yearFrom.trim(),
      yearTo: f.ongoing ? "~" : f.yearTo.trim(),
      iconUri: f.iconUri,
      status: Boolean(f.status),
    };
    if (editingModelEntry) {
      updateVehicleMakeModel(editingModelEntry.id, payload);
    } else {
      addVehicleMakeModel({ ...payload, isDefault: false });
    }
    setModalOpen(false);
  };

  const deleteModel = (entry: VehicleMakeModelRecord) => {
    Alert.alert("Delete model", "Remove this model?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeVehicleMakeModel(entry.id),
      },
    ]);
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an icon.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        setModelForm((p) => ({ ...p, iconUri: uri }));
      }
    } catch (e) {
      console.log("image pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  // ---------- Header copy per level ----------
  const levelMeta = useMemo(() => {
    if (level === 0)
      return {
        title: "Vehicle Types",
        subtitle: "Bike, Car, Truck, Pick Up, etc.",
        addLabel: "Add Vehicle Type",
        Icon: Car,
      };
    if (level === 1)
      return {
        title: "Energy Types",
        subtitle: "Petrol, Diesel, EV, Hybrid, etc.",
        addLabel: "Add Energy Type",
        Icon: Fuel,
      };
    if (level === 2)
      return {
        title: "Makes",
        subtitle: "BMW, Proton, Perodua, etc.",
        addLabel: "Add Make",
        Icon: Factory,
      };
    return {
      title: "Models",
      subtitle: "Wira, 530i, etc. with year range",
      addLabel: "Add Model",
      Icon: Tag,
    };
  }, [level]);

  // ---------- Renderers ----------
  const renderCategoryRow = (
    lvl: Level,
    name: string,
    count: number,
    onOpen: () => void
  ) => {
    const Icon =
      lvl === 0 ? Car : lvl === 1 ? Fuel : lvl === 2 ? Factory : Tag;
    return (
      <TouchableOpacity
        key={`${lvl}-${name}`}
        onPress={onOpen}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`vmm-cat-${lvl}-${name}`}
        activeOpacity={0.85}
      >
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          <Icon color={Colors.accent} size={18} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {count} {lvl === 2 ? "model" : lvl === 1 ? "make" : "energy type"}
            {count === 1 ? "" : "s"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openRenameCategory(lvl, name)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vmm-cat-edit-${lvl}-${name}`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Edit vehicle make and model category"
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => deleteCategory(lvl, name)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vmm-cat-del-${lvl}-${name}`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Delete vehicle make and model category"
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
        <ChevronRight color={Colors.textSecondary} size={18} />
      </TouchableOpacity>
    );
  };

  const renderModelRow = (m: ParsedEntry) => {
    const entry = entries.find((e) => e.id === m.id);
    if (!entry) return null;
    const yearLabel = formatYearRange(m.yearFrom, m.yearTo);
    return (
      <View
        key={m.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`vmm-model-${m.id}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          {m.iconUri ? (
            <Image source={{ uri: m.iconUri }} style={styles.rowIconImage} />
          ) : (
            <Tag color={Colors.accent} size={18} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleRow}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {m.model} {yearLabel}
            </Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: m.status ? Colors.success + "22" : Colors.error + "22" },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: m.status ? Colors.success : Colors.error },
                ]}
              >
                {m.status ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
          <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {m.make} • {m.energyType} • {m.vehicleType}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openEditModel(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vmm-model-edit-${m.id}`}
          accessibilityRole="button"
          accessibilityLabel="Edit vehicle make and model model"
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => deleteModel(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vmm-model-del-${m.id}`}
          accessibilityRole="button"
          accessibilityLabel="Delete vehicle make and model model"
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  // ---------- Body ----------
  let listBody: React.ReactNode;
  let emptyTitle = "Nothing here yet";
  let emptyDesc = "Tap the + button to add your first entry.";

  const hasQuery = query.trim().length > 0;
  const showGlobalModelSearch = hasQuery && level < 3;

  if (showGlobalModelSearch) {
    emptyTitle = "No matching models";
    emptyDesc = `No vehicles match "${query.trim()}".`;
    listBody = globalModelMatches.map((m) => renderModelRow(m));
  } else if (level === 0) {
    emptyTitle = "No vehicle types";
    emptyDesc = "Add a vehicle type like Car, Bike, Truck, or Pick Up.";
    listBody = filteredVehicleTypes.map((v) =>
      renderCategoryRow(0, v.name, v.count, () => goTo({ vehicleType: v.name }))
    );
  } else if (level === 1) {
    emptyTitle = "No energy types";
    emptyDesc = "Add an energy type like Petrol, Diesel, or EV.";
    listBody = filteredEnergyTypes.map((v) =>
      renderCategoryRow(1, v.name, v.count, () =>
        goTo({ vehicleType: path.vehicleType, energyType: v.name })
      )
    );
  } else if (level === 2) {
    emptyTitle = "No makes";
    emptyDesc = "Add a make like BMW, Proton, or Perodua.";
    listBody = filteredMakes.map((v) =>
      renderCategoryRow(2, v.name, v.count, () =>
        goTo({
          vehicleType: path.vehicleType,
          energyType: path.energyType,
          make: v.name,
        })
      )
    );
  } else {
    emptyTitle = "No models";
    emptyDesc = "Add a model like WIRA (1993 - 2009).";
    listBody = filteredModels.map((m) => renderModelRow(m));
  }

  const isEmpty = showGlobalModelSearch
    ? globalModelMatches.length === 0
    : (level === 0 && filteredVehicleTypes.length === 0) ||
      (level === 1 && filteredEnergyTypes.length === 0) ||
      (level === 2 && filteredMakes.length === 0) ||
      (level === 3 && filteredModels.length === 0);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (level === 0) {
              router.back();
            } else if (level === 3) {
              goTo({ vehicleType: path.vehicleType, energyType: path.energyType });
            } else if (level === 2) {
              goTo({ vehicleType: path.vehicleType });
            } else {
              goTo({});
            }
          }}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="vmm-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <levelMeta.Icon color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              {levelMeta.title}
            </Text>
          </View>
          <Text
            style={[styles.headerSubtitle, { color: Colors.textSecondary }]}
            numberOfLines={1}
          >
            {levelMeta.subtitle}
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAddPicker}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="vmm-add"
          accessibilityRole="button"
          accessibilityLabel="Add vehicle make and model"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      {/* Breadcrumbs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.crumbsScroll}
        contentContainerStyle={styles.crumbs}
      >
        {breadcrumbs.map((c, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <View key={c.id} style={styles.crumbItem}>
              <TouchableOpacity
                onPress={c.onPress}
                disabled={isLast}
                style={[
                  styles.crumbBtn,
                  {
                    backgroundColor: isLast ? Colors.accent : Colors.gray[100],
                    borderColor: isLast ? Colors.accent : Colors.border,
                  },
                ]}
                testID={`vmm-crumb-${c.id}`}
              >
                {idx === 0 ? (
                  <HomeIcon
                    color={isLast ? Colors.onAccent : Colors.text}
                    size={12}
                  />
                ) : null}
                <Text
                  style={[
                    styles.crumbText,
                    { color: isLast ? Colors.onAccent : Colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {c.label}
                </Text>
              </TouchableOpacity>
              {!isLast && <ChevronRight color={Colors.textSecondary} size={14} />}
            </View>
          );
        })}
      </ScrollView>

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
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="vmm-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isEmpty ? (
          <View
            style={[
              styles.emptyBox,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>{emptyTitle}</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              {emptyDesc}
            </Text>
            <TouchableOpacity
              onPress={openAddPicker}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="vmm-empty-add"
              accessibilityRole="button"
              accessibilityLabel="Add vehicle make and model"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>
                {levelMeta.addLabel}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          listBody
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {modalMode === "category"
                    ? `${categoryRenameFrom ? "Rename" : "Add"} ${
                        categoryLevel === 0
                          ? "Vehicle Type"
                          : categoryLevel === 1
                          ? "Energy Type"
                          : "Make"
                      }`
                    : editingModelEntry
                    ? "Edit Model"
                    : "Add Model"}
                </Text>
                <TouchableOpacity
                  onPress={() => setModalOpen(false)}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="vmm-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              {modalMode === "category" ? (
                <ScrollView
                  style={{ maxHeight: 540 }}
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {!categoryRenameFrom && categoryLevel >= 1 && (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: Colors.textSecondary }]}>
                        Vehicle Type *
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <TextInput
                          value={categoryParents.vehicleType ?? ""}
                          onChangeText={(t) =>
                            setCategoryParents((p) => ({ ...p, vehicleType: t }))
                          }
                          placeholder="e.g. Car"
                          placeholderTextColor={Colors.textSecondary}
                          style={[styles.input, { color: Colors.text }]}
                          testID="vmm-cat-parent-vt"
                        />
                      </View>
                      {vehicleTypes.length > 0 && (
                        <View style={[styles.chipsRow, { marginTop: 8 }]}>
                          {vehicleTypes.map((v) => {
                            const active = categoryParents.vehicleType === v.name;
                            return (
                              <TouchableOpacity
                                key={`cp-vt-${v.name}`}
                                onPress={() =>
                                  setCategoryParents((p) => ({
                                    ...p,
                                    vehicleType: v.name,
                                  }))
                                }
                                style={[
                                  styles.suggestChip,
                                  {
                                    backgroundColor: active
                                      ? Colors.accent
                                      : Colors.gray[100],
                                    borderColor: active ? Colors.accent : Colors.border,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    { color: active ? Colors.onAccent : Colors.text },
                                  ]}
                                >
                                  {v.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}

                  {!categoryRenameFrom && categoryLevel >= 2 && (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: Colors.textSecondary }]}>
                        Energy Type *
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <TextInput
                          value={categoryParents.energyType ?? ""}
                          onChangeText={(t) =>
                            setCategoryParents((p) => ({ ...p, energyType: t }))
                          }
                          placeholder="e.g. Petrol"
                          placeholderTextColor={Colors.textSecondary}
                          style={[styles.input, { color: Colors.text }]}
                          testID="vmm-cat-parent-et"
                        />
                      </View>
                      {allEnergyTypesForVT.length > 0 && (
                        <View style={[styles.chipsRow, { marginTop: 8 }]}>
                          {allEnergyTypesForVT.map((name) => {
                            const active = categoryParents.energyType === name;
                            return (
                              <TouchableOpacity
                                key={`cp-et-${name}`}
                                onPress={() =>
                                  setCategoryParents((p) => ({
                                    ...p,
                                    energyType: name,
                                  }))
                                }
                                style={[
                                  styles.suggestChip,
                                  {
                                    backgroundColor: active
                                      ? Colors.accent
                                      : Colors.gray[100],
                                    borderColor: active ? Colors.accent : Colors.border,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    { color: active ? Colors.onAccent : Colors.text },
                                  ]}
                                >
                                  {name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      {categoryLevel === 0
                        ? "Vehicle Type Name *"
                        : categoryLevel === 1
                        ? "Energy Type Name *"
                        : "Make Name *"}
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={categoryName}
                        onChangeText={setCategoryName}
                        placeholder={
                          categoryLevel === 0
                            ? "e.g. Car"
                            : categoryLevel === 1
                            ? "e.g. Petrol"
                            : "e.g. BMW"
                        }
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="vmm-cat-name"
                        autoFocus={categoryLevel === 0 || !!categoryRenameFrom}
                      />
                    </View>
                    {categoryNameSuggestions.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.helper,
                            { color: Colors.textSecondary, marginTop: 8 },
                          ]}
                        >
                          {categoryRenameFrom
                            ? "Existing at this level"
                            : "Already exists \u2014 tap to open instead of duplicating"}
                        </Text>
                        <View style={[styles.chipsRow, { marginTop: 6 }]}>
                          {categoryNameSuggestions.map((name) => {
                            const active =
                              norm(categoryName) === norm(name);
                            return (
                              <TouchableOpacity
                                key={`cat-sugg-${categoryLevel}-${name}`}
                                onPress={() => {
                                  if (categoryRenameFrom) {
                                    setCategoryName(name);
                                  } else {
                                    pickExistingCategory(name);
                                  }
                                }}
                                style={[
                                  styles.suggestChip,
                                  {
                                    backgroundColor: active
                                      ? Colors.accent
                                      : Colors.gray[100],
                                    borderColor: active
                                      ? Colors.accent
                                      : Colors.border,
                                  },
                                ]}
                                testID={`vmm-cat-sugg-${name}`}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    {
                                      color: active
                                        ? Colors.onAccent
                                        : Colors.text,
                                    },
                                  ]}
                                >
                                  {name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={saveCategory}
                    style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                    testID="vmm-cat-save"
                    accessibilityRole="button"
                    accessibilityLabel="Save"
                  >
                    <Save color={Colors.onAccent} size={18} />
                    <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                      {categoryRenameFrom ? "Save changes" : "Add"}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                <ScrollView
                  style={{ maxHeight: 540 }}
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Icon upload */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Model Icon
                    </Text>
                    <View style={styles.iconRow}>
                      <View
                        style={[
                          styles.iconPreview,
                          {
                            backgroundColor: Colors.accent + "22",
                            borderColor: Colors.border,
                          },
                        ]}
                      >
                        {modelForm.iconUri ? (
                          <Image
                            source={{ uri: modelForm.iconUri }}
                            style={styles.iconPreviewImage}
                          />
                        ) : (
                          <ImageIcon color={Colors.accent} size={26} />
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 8 }}>
                        <TouchableOpacity
                          onPress={pickImage}
                          style={[
                            styles.uploadBtn,
                            { backgroundColor: Colors.accent, borderColor: Colors.accent },
                          ]}
                          testID="vmm-model-icon-upload"
                          accessibilityRole="button"
                          accessibilityLabel="Upload vehicle make and model model icon"
                        >
                          <Upload color={Colors.onAccent} size={16} />
                          <Text
                            style={[styles.uploadBtnText, { color: Colors.onAccent }]}
                          >
                            {modelForm.iconUri ? "Change Image" : "Upload Image"}
                          </Text>
                        </TouchableOpacity>
                        {!!modelForm.iconUri && (
                          <TouchableOpacity
                            onPress={() => setModelForm((p) => ({ ...p, iconUri: "" }))}
                            style={[
                              styles.uploadBtn,
                              {
                                backgroundColor: Colors.gray[100],
                                borderColor: Colors.border,
                              },
                            ]}
                            testID="vmm-model-icon-remove"
                          >
                            <X color={Colors.text} size={16} />
                            <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                              Remove
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* Vehicle Type */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Vehicle Type *
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={modelForm.vehicleType}
                        onChangeText={(t) =>
                          setModelForm((p) => ({ ...p, vehicleType: t }))
                        }
                        placeholder="Car"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="vmm-model-vtype"
                      />
                    </View>
                    {vehicleTypes.length > 0 && (
                      <View style={[styles.chipsRow, { marginTop: 8 }]}>
                        {vehicleTypes.map((v) => (
                          <TouchableOpacity
                            key={`vt-${v.name}`}
                            onPress={() =>
                              setModelForm((p) => ({ ...p, vehicleType: v.name }))
                            }
                            style={[
                              styles.suggestChip,
                              {
                                backgroundColor:
                                  modelForm.vehicleType === v.name
                                    ? Colors.accent
                                    : Colors.gray[100],
                                borderColor:
                                  modelForm.vehicleType === v.name
                                    ? Colors.accent
                                    : Colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color:
                                    modelForm.vehicleType === v.name
                                      ? Colors.onAccent
                                      : Colors.text,
                                },
                              ]}
                            >
                              {v.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Energy Type */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Energy Type *
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={modelForm.energyType}
                        onChangeText={(t) =>
                          setModelForm((p) => ({ ...p, energyType: t }))
                        }
                        placeholder="Petrol"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="vmm-model-etype"
                      />
                    </View>
                    {modelEnergySuggestions.length > 0 && (
                      <View style={[styles.chipsRow, { marginTop: 8 }]}>
                        {modelEnergySuggestions.map((name) => {
                          const active = norm(modelForm.energyType) === norm(name);
                          return (
                            <TouchableOpacity
                              key={`m-et-${name}`}
                              onPress={() =>
                                setModelForm((p) => ({ ...p, energyType: name }))
                              }
                              style={[
                                styles.suggestChip,
                                {
                                  backgroundColor: active
                                    ? Colors.accent
                                    : Colors.gray[100],
                                  borderColor: active
                                    ? Colors.accent
                                    : Colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  {
                                    color: active
                                      ? Colors.onAccent
                                      : Colors.text,
                                  },
                                ]}
                              >
                                {name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* Make */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Make *
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={modelForm.make}
                        onChangeText={(t) => setModelForm((p) => ({ ...p, make: t }))}
                        placeholder="Proton"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="vmm-model-make"
                      />
                    </View>
                    {modelMakeSuggestions.length > 0 && (
                      <View style={[styles.chipsRow, { marginTop: 8 }]}>
                        {modelMakeSuggestions.map((name) => {
                          const active = norm(modelForm.make) === norm(name);
                          return (
                            <TouchableOpacity
                              key={`m-mk-${name}`}
                              onPress={() =>
                                setModelForm((p) => ({ ...p, make: name }))
                              }
                              style={[
                                styles.suggestChip,
                                {
                                  backgroundColor: active
                                    ? Colors.accent
                                    : Colors.gray[100],
                                  borderColor: active
                                    ? Colors.accent
                                    : Colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  {
                                    color: active
                                      ? Colors.onAccent
                                      : Colors.text,
                                  },
                                ]}
                              >
                                {name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* Model */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Model *
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={modelForm.model}
                        onChangeText={(t) => setModelForm((p) => ({ ...p, model: t }))}
                        placeholder="WIRA"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="vmm-model-name"
                      />
                    </View>
                    {modelNameSuggestions.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.helper,
                            { color: Colors.textSecondary, marginTop: 8 },
                          ]}
                        >
                          {editingModelEntry
                            ? "Existing in this make"
                            : "Already exists \u2014 tap to edit instead of duplicating"}
                        </Text>
                        <View style={[styles.chipsRow, { marginTop: 6 }]}>
                          {modelNameSuggestions.map((m) => {
                            const label = `${m.model}${
                              formatYearRange(m.yearFrom, m.yearTo)
                                ? " " + formatYearRange(m.yearFrom, m.yearTo)
                                : ""
                            }`;
                            const active =
                              !!editingModelEntry && editingModelEntry.id === m.id;
                            return (
                              <TouchableOpacity
                                key={`m-md-${m.id}`}
                                onPress={() => {
                                  const entry = entries.find((e) => e.id === m.id);
                                  if (entry) openEditModel(entry);
                                }}
                                style={[
                                  styles.suggestChip,
                                  {
                                    backgroundColor: active
                                      ? Colors.accent
                                      : Colors.gray[100],
                                    borderColor: active
                                      ? Colors.accent
                                      : Colors.border,
                                  },
                                ]}
                                testID={`vmm-model-sugg-${m.id}`}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    {
                                      color: active
                                        ? Colors.onAccent
                                        : Colors.text,
                                    },
                                  ]}
                                >
                                  {label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>

                  {/* Year range */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      Year Range
                    </Text>
                    <View style={styles.yearRow}>
                      <View
                        style={[
                          styles.inputWrap,
                          {
                            flex: 1,
                            backgroundColor: Colors.gray[100],
                            borderColor: Colors.border,
                          },
                        ]}
                      >
                        <TextInput
                          value={modelForm.yearFrom}
                          onChangeText={(t) =>
                            setModelForm((p) => ({ ...p, yearFrom: t }))
                          }
                          placeholder="1993"
                          placeholderTextColor={Colors.textSecondary}
                          keyboardType="number-pad"
                          maxLength={4}
                          style={[styles.input, { color: Colors.text }]}
                          testID="vmm-model-yearFrom"
                        />
                      </View>
                      <Text style={[styles.yearDash, { color: Colors.textSecondary }]}>
                        –
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          {
                            flex: 1,
                            backgroundColor: modelForm.ongoing
                              ? Colors.background
                              : Colors.gray[100],
                            borderColor: Colors.border,
                            opacity: modelForm.ongoing ? 0.5 : 1,
                          },
                        ]}
                      >
                        <TextInput
                          value={modelForm.ongoing ? "" : modelForm.yearTo}
                          onChangeText={(t) =>
                            setModelForm((p) => ({ ...p, yearTo: t }))
                          }
                          placeholder={modelForm.ongoing ? "Ongoing" : "2009"}
                          placeholderTextColor={Colors.textSecondary}
                          keyboardType="number-pad"
                          maxLength={4}
                          editable={!modelForm.ongoing}
                          style={[styles.input, { color: Colors.text }]}
                          testID="vmm-model-yearTo"
                        />
                      </View>
                    </View>
                    <View
                      style={[
                        styles.toggleRow,
                        {
                          backgroundColor: Colors.gray[100],
                          borderColor: Colors.border,
                          marginTop: 8,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                          Ongoing (~)
                        </Text>
                        <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                          Model is still in production
                        </Text>
                      </View>
                      <Switch
                        value={Boolean(modelForm.ongoing)}
                        onValueChange={(v) =>
                          setModelForm((p) => ({ ...p, ongoing: v, yearTo: v ? "" : p.yearTo }))
                        }
                        testID="vmm-model-ongoing"
                      />
                    </View>
                    <Text
                      style={[
                        styles.helper,
                        { color: Colors.textSecondary, marginTop: 8 },
                      ]}
                    >
                      Preview:{" "}
                      {formatYearRange(
                        modelForm.yearFrom,
                        modelForm.ongoing ? "~" : modelForm.yearTo
                      ) || "(no year range)"}
                    </Text>
                  </View>

                  {/* Status */}
                  <View
                    style={[
                      styles.toggleRow,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                        Status
                      </Text>
                      <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                        {modelForm.status ? "Active" : "Inactive"}
                      </Text>
                    </View>
                    <Switch
                      value={Boolean(modelForm.status)}
                      onValueChange={(v) =>
                        setModelForm((p) => ({ ...p, status: v }))
                      }
                      testID="vmm-model-status"
                    />
                  </View>

                  <TouchableOpacity
                    onPress={saveModel}
                    style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                    testID="vmm-model-save"
                    accessibilityRole="button"
                    accessibilityLabel="Save"
                  >
                    <Save color={Colors.onAccent} size={18} />
                    <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                      {editingModelEntry ? "Save changes" : "Add Model"}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={addPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setAddPickerOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setAddPickerOpen(false)}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.pickerSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  Add Entry
                </Text>
                <TouchableOpacity
                  onPress={() => setAddPickerOpen(false)}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="vmm-picker-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>
              <Text
                style={[
                  styles.helper,
                  { color: Colors.textSecondary, marginBottom: 12 },
                ]}
              >
                Choose what you want to add directly.
              </Text>
              {([
                { id: "vt", label: "Add Vehicle Type", desc: "Bike, Car, Truck, Pick Up...", Icon: Car },
                { id: "et", label: "Add Energy Type", desc: "Petrol, Diesel, EV, Hybrid...", Icon: Fuel },
                { id: "make", label: "Add Make", desc: "BMW, Proton, Perodua...", Icon: Factory },
                { id: "model", label: "Add Model", desc: "Wira, 530i with year range", Icon: Tag },
              ] as const).map((opt) => {
                const Icon = opt.Icon;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => handleAddPicker(opt.id)}
                    style={[
                      styles.pickerRow,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                    testID={`vmm-picker-${opt.id}`}
                    activeOpacity={0.85}
                  >
                    <View
                      style={[
                        styles.rowIcon,
                        { backgroundColor: Colors.accent + "20" },
                      ]}
                    >
                      <Icon color={Colors.accent} size={18} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: Colors.text }]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.rowMeta, { color: Colors.textSecondary }]}>
                        {opt.desc}
                      </Text>
                    </View>
                    <ChevronRight color={Colors.textSecondary} size={18} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  iconBtnSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  crumbsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  crumbs: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  crumbItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexShrink: 0,
  },
  crumbBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  crumbText: { fontSize: 12, fontWeight: "700" as const },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  rowLabel: { fontSize: 15, fontWeight: "700" as const, flexShrink: 1 },
  rowMeta: { fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: { fontSize: 10, fontWeight: "800" as const },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { fontSize: 13, fontWeight: "800" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
    gap: 10,
    width: "100%" as const,
  },
  pickerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  helper: { fontSize: 11 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  iconPreview: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    borderWidth: 1,
  },
  iconPreviewImage: {
    width: "100%" as const,
    height: "100%" as const,
    borderRadius: 14,
  },
  rowIconImage: {
    width: "100%" as const,
    height: "100%" as const,
    borderRadius: 20,
  },
  uploadBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  uploadBtnText: { fontSize: 13, fontWeight: "700" as const },
  chipsRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  suggestChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "700" as const },
  yearRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  yearDash: { fontSize: 18, fontWeight: "800" as const },
  submitBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginTop: 6,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
});
