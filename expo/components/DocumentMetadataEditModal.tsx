import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { X, Save, Trash2, Calendar } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export interface EditableDocMetadata {
  doc_name: string;
  document_number: string | null;
  insurance_provider_name: string | null;
  issuance_country: string | null;
  start_date: string | null;
  expiry_date: string | null;
  is_pwd: boolean;
}

interface Props {
  visible: boolean;
  initial: EditableDocMetadata | null;
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (patch: EditableDocMetadata) => void;
  onDelete: () => void;
}

function fmtDateInput(v: string | null): string {
  if (!v) return "";
  // expecting ISO date (YYYY-MM-DD) or full ISO timestamp
  return v.slice(0, 10);
}

export default function DocumentMetadataEditModal({
  visible,
  initial,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const Colors = useColors();
  const [docName, setDocName] = useState<string>("");
  const [docNumber, setDocNumber] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [isPwd, setIsPwd] = useState<boolean>(false);
  const [showStartPicker, setShowStartPicker] = useState<boolean>(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState<boolean>(false);

  useEffect(() => {
    if (visible && initial) {
      setDocName(initial.doc_name ?? "");
      setDocNumber(initial.document_number ?? "");
      setProvider(initial.insurance_provider_name ?? "");
      setCountry(initial.issuance_country ?? "");
      setStartDate(fmtDateInput(initial.start_date));
      setExpiryDate(fmtDateInput(initial.expiry_date));
      setIsPwd(Boolean(initial.is_pwd));
      setShowStartPicker(false);
      setShowExpiryPicker(false);
    }
  }, [visible, initial]);

  const handleSave = () => {
    if (!docName.trim()) {
      Alert.alert("Name required", "Document name cannot be empty.");
      return;
    }
    onSave({
      doc_name: docName.trim(),
      document_number: docNumber.trim() || null,
      insurance_provider_name: provider.trim() || null,
      issuance_country: country.trim() || null,
      start_date: startDate.trim() || null,
      expiry_date: expiryDate.trim() || null,
      is_pwd: isPwd,
    });
  };

  const confirmDelete = () => {
    Alert.alert("Delete document?", "This permanently removes the document record.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDelete },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={["bottom"]}>
        <View style={[styles.header, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            testID="doc-edit-close"
            accessibilityRole="button"
          >
            <X color={Colors.text} size={22} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: Colors.text }]}>Edit document</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>Update any field or remove the record.</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Field label="Document name" Colors={Colors}>
            <TextInput
              value={docName}
              onChangeText={setDocName}
              placeholder="e.g. Driving Licence"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
              testID="doc-edit-name"
            />
          </Field>

          <Field label="Document number" Colors={Colors}>
            <TextInput
              value={docNumber}
              onChangeText={setDocNumber}
              placeholder="Optional"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="characters"
              style={[styles.input, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
              testID="doc-edit-number"
            />
          </Field>

          <Field label="Provider / issuer" Colors={Colors}>
            <TextInput
              value={provider}
              onChangeText={setProvider}
              placeholder="e.g. Allianz, JPJ"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
              testID="doc-edit-provider"
            />
          </Field>

          <Field label="Country of issuance" Colors={Colors}>
            <TextInput
              value={country}
              onChangeText={setCountry}
              placeholder="e.g. Malaysia"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
              testID="doc-edit-country"
            />
          </Field>

          <DateField
            label="Start date"
            value={startDate}
            onChange={setStartDate}
            show={showStartPicker}
            setShow={setShowStartPicker}
            Colors={Colors}
            testID="doc-edit-start"
          />
          <DateField
            label="Expiry date"
            value={expiryDate}
            onChange={setExpiryDate}
            show={showExpiryPicker}
            setShow={setShowExpiryPicker}
            Colors={Colors}
            testID="doc-edit-expiry"
          />

          <View style={[styles.row, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: Colors.text }]}>Disabled / PWD</Text>
              <Text style={[styles.rowHint, { color: Colors.textSecondary }]}>Mark this document as a PWD record.</Text>
            </View>
            <Switch value={isPwd} onValueChange={setIsPwd} testID="doc-edit-pwd" />
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
          <TouchableOpacity
            onPress={confirmDelete}
            disabled={deleting || saving}
            style={[styles.actionBtn, { backgroundColor: Colors.error + "20", borderColor: Colors.error }]}
            testID="doc-edit-delete"
            accessibilityRole="button"
          >
            {deleting ? (
              <ActivityIndicator color={Colors.error} size="small" />
            ) : (
              <>
                <Trash2 color={Colors.error} size={18} />
                <Text style={[styles.actionText, { color: Colors.error }]}>Delete</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || deleting}
            style={[styles.actionBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
            testID="doc-edit-save"
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={Colors.onAccent} size="small" />
            ) : (
              <>
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.actionText, { color: Colors.onAccent }]}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

interface ColorsLike {
  text: string;
  textSecondary: string;
  border: string;
  gray: Record<number, string>;
  accent: string;
  secondary: string;
  error: string;
  background: string;
}

function Field({ label, children, Colors }: { label: string; children: React.ReactNode; Colors: ColorsLike }) {
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  setShow: (v: boolean) => void;
  Colors: ColorsLike;
  testID: string;
}

function DateField({ label, value, onChange, show, setShow, Colors, testID }: DateFieldProps) {
  const dateObj = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00") : new Date();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginBottom: 6 }]}>{label}</Text>
      <View style={{ flexDirection: "row" as const, gap: 8 }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textSecondary}
          style={[
            styles.input,
            { flex: 1, backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border },
          ]}
          testID={`${testID}-input`}
        />
        <TouchableOpacity
          onPress={() => setShow(true)}
          style={[styles.dateBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID={`${testID}-picker-btn`}
          accessibilityRole="button"
          accessibilityLabel="Pick a date"
        >
          <Calendar color={Colors.text} size={18} />
        </TouchableOpacity>
        {value ? (
          <TouchableOpacity
            onPress={() => onChange("")}
            style={[styles.dateBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            testID={`${testID}-clear`}
            accessibilityRole="button"
          >
            <X color={Colors.text} size={18} />
          </TouchableOpacity>
        ) : null}
      </View>
      {show ? (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(_, d) => {
            if (Platform.OS !== "ios") setShow(false);
            if (d) {
              const iso = d.toISOString().slice(0, 10);
              onChange(iso);
            }
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  title: { fontSize: 18, fontWeight: "800" as const },
  subtitle: { fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 32 },
  fieldLabel: { fontSize: 12, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  dateBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  rowLabel: { fontSize: 14, fontWeight: "700" as const },
  rowHint: { fontSize: 12, marginTop: 2 },
  footer: {
    flexDirection: "row" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionText: { fontSize: 15, fontWeight: "800" as const },
});
