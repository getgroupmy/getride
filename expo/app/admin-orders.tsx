import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Package,
  Search,
  Filter,
  UserCheck,
  Check,
  ChevronRight,
  Hash,
  Banknote,
  Palette,
  Sofa,
  X,
  Phone,
  Mail,
  MapPin,
  Building2,
  CalendarDays,
  Zap,
  CircleDot,
  Wrench,
  User,
  Users,
  Briefcase,
  IdCard,
  Globe,
  Heart,
  FileText,
  Wallet,
  CreditCard,
  ClipboardCheck,
  ClipboardList,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";

type FilterKey = "all" | "pending" | "assigned" | "in-progress" | "delivered" | "refit";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "refit", label: "Re-fit" },
  { key: "pending", label: "Pending DA" },
  { key: "assigned", label: "Assigned" },
  { key: "in-progress", label: "In progress" },
  { key: "delivered", label: "Delivered" },
];

export default function AdminOrdersScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { getEntries, updateEntry } = useAdminData();

  const orders = getEntries("ev-orders");
  const advisors = getEntries("ev-delivery-advisors");
  const vehicleDetails = getEntries("ev-vehicle-details");

  const vehicleById = useMemo<Map<string, SettingEntry>>(() => {
    const m = new Map<string, SettingEntry>();
    vehicleDetails.forEach((v) => m.set(v.id, v));
    return m;
  }, [vehicleDetails]);

  const parseStringList = (raw: string | number | boolean | undefined): string[] => {
    if (!raw || typeof raw !== "string") return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<SettingEntry | null>(null);
  const [assignVisible, setAssignVisible] = useState<boolean>(false);

  const orderGallery = useMemo<{ uri: string; label: string }[]>(() => {
    if (!selected) return [];
    const vid = selected.values.vehicleId ? String(selected.values.vehicleId) : "";
    const veh = vid ? vehicleById.get(vid) ?? null : null;
    if (!veh) return [];
    const ext = parseStringList(veh.values.exteriorImages).map((uri) => ({ uri, label: "Exterior" }));
    const intr = parseStringList(veh.values.interiorImages).map((uri) => ({ uri, label: "Interior" }));
    const stor = parseStringList(veh.values.storageImages).map((uri) => ({ uri, label: "Storage" }));
    return [...ext, ...intr, ...stor];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, vehicleById]);

  const filtered = useMemo<SettingEntry[]>(() => {
    let list = orders;
    if (filter === "refit") {
      list = list.filter((o) => !!o.values.wheelsSwapped);
    } else if (filter !== "all") {
      list = list.filter((o) => String(o.values.status ?? "pending") === filter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((o) => {
        const blob = `${o.values.customerName ?? ""} ${o.values.customerPhone ?? ""} ${o.values.vehicle ?? ""} ${o.id} ${o.values.advisorName ?? ""}`.toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }, [orders, filter, query]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      total: orders.length,
      pending: 0,
      assigned: 0,
      "in-progress": 0,
      delivered: 0,
      refit: 0,
    };
    orders.forEach((o) => {
      const s = String(o.values.status ?? "pending");
      counts[s] = (counts[s] ?? 0) + 1;
      if (o.values.wheelsSwapped) counts.refit += 1;
    });
    return counts;
  }, [orders]);

  const statusColor = (s: string): string => {
    switch (s) {
      case "delivered":
        return Colors.success;
      case "in-progress":
        return Colors.accent;
      case "assigned":
        return "#3B82F6";
      case "pending":
      default:
        return Colors.warning ?? "#F59E0B";
    }
  };

  const statusLabel = (s: string): string => {
    switch (s) {
      case "delivered":
        return "Delivered";
      case "in-progress":
        return "In progress";
      case "assigned":
        return "DA assigned";
      case "pending":
      default:
        return "Pending DA";
    }
  };

  const assignAdvisor = (advisor: SettingEntry) => {
    if (!selected) return;
    updateEntry("ev-orders", selected.id, {
      ...selected.values,
      advisorId: advisor.id,
      advisorName: String(advisor.values.name ?? ""),
      advisorContact: String(advisor.values.contact ?? ""),
      advisorEmail: String(advisor.values.email ?? ""),
      advisorDealership: String(advisor.values.dealership ?? ""),
      advisorDaNumber: String(advisor.values.daNumber ?? advisor.id),
      advisorCountry: String(advisor.values.country ?? ""),
      advisorState: String(advisor.values.state ?? ""),
      advisorCity: String(advisor.values.city ?? ""),
      status: "assigned",
      assignedAt: new Date().toISOString(),
    });
    setSelected({
      ...selected,
      values: {
        ...selected.values,
        advisorId: advisor.id,
        advisorName: String(advisor.values.name ?? ""),
        status: "assigned",
      },
    });
    setAssignVisible(false);
    Alert.alert("DA assigned", `${String(advisor.values.name ?? "Advisor")} has been assigned to this order.`);
  };

  const setOrderStatus = (status: string) => {
    if (!selected) return;
    updateEntry("ev-orders", selected.id, { ...selected.values, status });
    setSelected({ ...selected, values: { ...selected.values, status } });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="orders-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Package color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>EV Orders</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {stats.total} total · {stats.pending ?? 0} awaiting DA
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={16} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by customer, vehicle, order ID"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="orders-search"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => {
          const sel = filter === f.key;
          const count =
            f.key === "all" ? stats.total : stats[f.key] ?? 0;
          const isRefit = f.key === "refit";
          const refitColor = Colors.warning ?? "#F59E0B";
          const activeBg = isRefit ? refitColor : Colors.accent;
          const ChipIcon = isRefit ? Wrench : Filter;
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: sel ? activeBg : Colors.gray[100],
                  borderColor: sel ? activeBg : Colors.border,
                },
              ]}
              testID={`orders-filter-${f.key}`}
            >
              <ChipIcon color={sel ? Colors.onAccent : (isRefit ? refitColor : Colors.text)} size={12} />
              <Text style={[styles.filterText, { color: sel ? Colors.onAccent : Colors.text }]}>
                {f.label}
              </Text>
              <View style={[styles.filterCount, { backgroundColor: sel ? Colors.onAccent + "30" : Colors.background }]}>
                <Text style={[styles.filterCountText, { color: sel ? Colors.onAccent : Colors.textSecondary }]}>{count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Package color={Colors.textSecondary} size={32} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No orders yet</Text>
            <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
              New EV orders submitted by users will appear here for review and DA assignment.
            </Text>
          </View>
        ) : (
          filtered.map((o) => {
            const status = String(o.values.status ?? "pending");
            const sc = statusColor(status);
            return (
              <TouchableOpacity
                key={o.id}
                style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                onPress={() => setSelected(o)}
                testID={`order-${o.id}`}
                activeOpacity={0.85}
              >
                <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Zap color={Colors.accent} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>
                      {String(o.values.customerName ?? "Customer")}
                    </Text>
                    <View style={[styles.statusPill, { backgroundColor: sc + "20" }]}>
                      <View style={[styles.statusDot, { backgroundColor: sc }]} />
                      <Text style={[styles.statusText, { color: sc }]}>{statusLabel(status)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {String(o.values.vehicle ?? "TEKSI EV")} · RM{Number(o.values.total ?? 0).toLocaleString()}
                  </Text>
                  <Text style={[styles.cardMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {o.values.advisorName ? `DA: ${String(o.values.advisorName)}` : `Order #${o.id.slice(-6).toUpperCase()}`}
                  </Text>
                  {!!o.values.wheelsSwapped && (
                    <View style={[styles.refitPill, { backgroundColor: (Colors.warning ?? "#F59E0B") + "20" }]}>
                      <Wrench color={Colors.warning ?? "#F59E0B"} size={10} />
                      <Text style={[styles.refitPillText, { color: Colors.warning ?? "#F59E0B" }]}>Re-fit wheels</Text>
                    </View>
                  )}
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
            <View style={[styles.sheetHandle, { backgroundColor: Colors.border }]} />

            {!!selected && (
              <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                <View style={styles.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetTitle, { color: Colors.text }]}>
                      {String(selected.values.customerName ?? "Customer")}
                    </Text>
                    <Text style={[styles.sheetSub, { color: Colors.textSecondary }]}>
                      Order #{selected.id.slice(-6).toUpperCase()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelected(null)}
                    style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                    testID="order-close"
                  >
                    <X color={Colors.text} size={20} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.statusBig, { backgroundColor: statusColor(String(selected.values.status ?? "pending")) + "15", borderColor: statusColor(String(selected.values.status ?? "pending")) }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(String(selected.values.status ?? "pending")) }]} />
                  <Text style={[styles.statusBigText, { color: statusColor(String(selected.values.status ?? "pending")) }]}>
                    {statusLabel(String(selected.values.status ?? "pending"))}
                  </Text>
                </View>

                <Text style={[styles.sectionTitle, { color: Colors.text }]}>Vehicle</Text>
                <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                  <Row Colors={Colors} Icon={Zap} label="Model" value={String(selected.values.vehicle ?? "—")} />
                  <Row Colors={Colors} Icon={Palette} label="Exterior" value={String(selected.values.exteriorColor ?? "—")} />
                  <Row Colors={Colors} Icon={Sofa} label="Interior" value={String(selected.values.interiorColor ?? "—")} />
                  <Row
                    Colors={Colors}
                    Icon={CircleDot}
                    label="Wheels"
                    value={
                      selected.values.wheelsSwapped && selected.values.factoryWheels
                        ? `${String(selected.values.wheels ?? "—")} (was ${String(selected.values.factoryWheels)})`
                        : String(selected.values.wheels ?? "—")
                    }
                  />
                  {!!selected.values.vin && (
                    <Row Colors={Colors} Icon={Hash} label="VIN" value={String(selected.values.vin)} />
                  )}
                  {!!selected.values.wheelsSwapped && (
                    <View style={[styles.refitBadge, { backgroundColor: (Colors.warning ?? "#F59E0B") + "20", borderColor: Colors.warning ?? "#F59E0B" }]} testID="order-refit-flag">
                      <Wrench color={Colors.warning ?? "#F59E0B"} size={14} />
                      <Text style={[styles.refitBadgeText, { color: Colors.warning ?? "#F59E0B" }]} numberOfLines={2}>
                        Re-fit required: wheels swapped from {String(selected.values.factoryWheels ?? "factory")} to {String(selected.values.wheels ?? "—")}.
                      </Text>
                    </View>
                  )}
                  <Row Colors={Colors} Icon={Banknote} label="Total" value={`RM${Number(selected.values.total ?? 0).toLocaleString()}`} />
                  <Row Colors={Colors} Icon={CalendarDays} label="Placed" value={new Date(selected.createdAt).toLocaleDateString()} />
                </View>

                {orderGallery.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>Buyer’s gallery</Text>
                    <GalleryStrip Colors={Colors} images={orderGallery} testIDPrefix="order-gallery" />
                  </>
                )}

                <Text style={[styles.sectionTitle, { color: Colors.text }]}>Customer</Text>
                <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                  <Row Colors={Colors} Icon={UserCheck} label="Name" value={String(selected.values.customerName ?? "—")} />
                  <Row Colors={Colors} Icon={Phone} label="Phone" value={String(selected.values.customerPhone ?? "—")} />
                  {!!selected.values.customerEmail && (
                    <Row Colors={Colors} Icon={Mail} label="Email" value={String(selected.values.customerEmail)} />
                  )}
                </View>

                {(() => {
                  const v = selected.values;
                  const ownerType = String(v.ownerType ?? "");
                  if (!ownerType && !v.ownerFullName && !v.companyName) return null;
                  const rawIdType = String(v.ownerIdType ?? "");
                  const isCompany = ownerType === "company" || rawIdType.startsWith("company+");
                  const idType = rawIdType.replace("company+", "");
                  const idTypeLabel = idType === "passport" ? "Passport" : idType === "national" ? "National ID" : idType || "—";
                  const ownerTypeLabel =
                    ownerType === "self" ? "My Self" : ownerType === "other" ? "Other Individual" : ownerType === "company" ? "Company" : "—";
                  const OwnerIcon = ownerType === "company" ? Briefcase : ownerType === "other" ? Users : User;
                  const idImage = v.ownerIdImage ? String(v.ownerIdImage) : "";
                  const ownerPhoto = v.ownerPhoto ? String(v.ownerPhoto) : "";
                  return (
                    <>
                      <Text style={[styles.sectionTitle, { color: Colors.text }]}>Ownership</Text>
                      <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                        <Row Colors={Colors} Icon={OwnerIcon} label="Type" value={ownerTypeLabel} />
                        {isCompany && (
                          <>
                            <Row Colors={Colors} Icon={Building2} label="Company" value={String(v.companyName ?? "—")} />
                            <Row Colors={Colors} Icon={Hash} label="Reg #" value={String(v.companyRegNo ?? "—")} />
                            <Row Colors={Colors} Icon={MapPin} label="Co. addr" value={String(v.companyAddress ?? "—")} />
                          </>
                        )}
                        {ownerType === "other" && !!v.ownerRelationship && (
                          <Row Colors={Colors} Icon={Heart} label="Relation" value={String(v.ownerRelationship)} />
                        )}
                        <Row Colors={Colors} Icon={User} label="Full name" value={String(v.ownerFullName ?? "—")} />
                        <Row Colors={Colors} Icon={IdCard} label="ID type" value={idTypeLabel} />
                        {!!v.ownerIdCountry && (
                          <Row Colors={Colors} Icon={Globe} label="Issued in" value={String(v.ownerIdCountry)} />
                        )}
                        <Row Colors={Colors} Icon={Hash} label="ID #" value={String(v.ownerIdNumber ?? "—")} />
                        <Row Colors={Colors} Icon={MapPin} label="Address" value={String(v.ownerAddress ?? "—")} />
                        {(idImage || ownerPhoto) && (
                          <View style={styles.ownerDocsRow} testID="order-owner-docs">
                            {!!idImage && (
                              <View style={[styles.ownerDoc, { borderColor: Colors.border }]}>
                                <Image source={{ uri: idImage }} style={styles.ownerDocImg} />
                                <View style={[styles.galleryTag, { backgroundColor: Colors.background + "E6" }]}>
                                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                    <FileText color={Colors.text} size={10} />
                                    <Text style={[styles.galleryTagText, { color: Colors.text }]}>{idType === "passport" ? "Passport" : "ID"}</Text>
                                  </View>
                                </View>
                              </View>
                            )}
                            {!!ownerPhoto && (
                              <View style={[styles.ownerDoc, { borderColor: Colors.border }]}>
                                <Image source={{ uri: ownerPhoto }} style={styles.ownerDocImg} />
                                <View style={[styles.galleryTag, { backgroundColor: Colors.background + "E6" }]}>
                                  <Text style={[styles.galleryTagText, { color: Colors.text }]}>Photo</Text>
                                </View>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    </>
                  );
                })()}

                {(() => {
                  const v = selected.values;
                  const transfer = String(v.plateTransfer ?? "");
                  if (!transfer) return null;
                  return (
                    <>
                      <Text style={[styles.sectionTitle, { color: Colors.text }]}>Licence Plate</Text>
                      <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                        <Row Colors={Colors} Icon={Hash} label="Transfer" value={transfer === "yes" ? "Yes — transferring" : "No — new plate"} />
                        {transfer === "yes" && (
                          <Row Colors={Colors} Icon={Hash} label="Plate #" value={String(v.plateNumber ?? "—")} />
                        )}
                      </View>
                    </>
                  );
                })()}

                {(() => {
                  const v = selected.values;
                  const ft = String(v.financeType ?? "");
                  if (!ft) return null;
                  const ftLabel = ft === "cash" ? "Cash" : ft === "hp" ? "Hire Purchase" : ft === "leasing" ? "Leasing" : ft;
                  const cashPaid = v.cashBalancePaid === true || String(v.cashBalancePaid) === "true";
                  const leaseAddon = String(v.leasingAddonRequired ?? "");
                  const leaseAddonPaid = v.leasingAddonPaid === true || String(v.leasingAddonPaid) === "true";
                  return (
                    <>
                      <Text style={[styles.sectionTitle, { color: Colors.text }]}>Financing</Text>
                      <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                        <Row Colors={Colors} Icon={Wallet} label="Method" value={ftLabel} />
                        {!!v.financePlan && (
                          <Row Colors={Colors} Icon={FileText} label="Plan" value={String(v.financePlan)} />
                        )}
                        {ft === "cash" && (
                          <Row
                            Colors={Colors}
                            Icon={CreditCard}
                            label="Balance"
                            value={cashPaid ? `Paid · RM${Number(v.balancePaidAmount ?? 0).toLocaleString()}` : "Unpaid"}
                          />
                        )}
                        {ft === "leasing" && !!leaseAddon && (
                          <>
                            <Row Colors={Colors} Icon={Banknote} label="Add-on" value={leaseAddon === "yes" ? "Required" : "Not required"} />
                            {leaseAddon === "yes" && (
                              <Row
                                Colors={Colors}
                                Icon={CreditCard}
                                label="Add-on pay"
                                value={leaseAddonPaid ? `Paid · RM${Number(v.leasingAddonAmount ?? 0).toLocaleString()}` : "Unpaid"}
                              />
                            )}
                          </>
                        )}
                      </View>
                    </>
                  );
                })()}

                {!!selected.values.deliveryDate && (
                  <>
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>Schedule</Text>
                    <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <Row Colors={Colors} Icon={CalendarDays} label="Delivery" value={String(selected.values.deliveryDate)} />
                    </View>
                  </>
                )}

                {(() => {
                  const v = selected.values;
                  const submittedRaw = String(v.checklistSubmitted ?? "");
                  const submitted = submittedRaw === "true" || submittedRaw === "1";
                  const accepted = v.checklistAccepted === true || String(v.checklistAccepted) === "true";
                  let items: { name: string; done: boolean; note: string }[] = [];
                  try {
                    const raw = String(v.checklistResults ?? "");
                    if (raw) {
                      const parsed = JSON.parse(raw);
                      if (Array.isArray(parsed)) {
                        items = parsed.map((x: { name?: unknown; done?: unknown; note?: unknown }) => ({
                          name: String(x?.name ?? ""),
                          done: x?.done !== false,
                          note: String(x?.note ?? ""),
                        }));
                      }
                    }
                  } catch {
                    items = [];
                  }
                  if (!submitted && !accepted && items.length === 0) return null;
                  const accentColor = accepted ? Colors.success : submitted ? Colors.accent : Colors.warning ?? "#F59E0B";
                  const statusTxt = accepted ? "Customer accepted" : submitted ? "Submitted — awaiting customer" : "Not submitted";
                  return (
                    <>
                      <Text style={[styles.sectionTitle, { color: Colors.text }]}>Delivery Checklist</Text>
                      <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                        <View style={[styles.refitBadge, { backgroundColor: accentColor + "20", borderColor: accentColor }]} testID="order-checklist-status">
                          {accepted ? <ClipboardCheck color={accentColor} size={14} /> : <ClipboardList color={accentColor} size={14} />}
                          <Text style={[styles.refitBadgeText, { color: accentColor }]} numberOfLines={2}>{statusTxt}</Text>
                        </View>
                        {items.map((it, i) => (
                          <View key={`${it.name}-${i}`} style={styles.row} testID={`order-checklist-${i}`}>
                            <View style={[styles.rowIcon, { backgroundColor: (it.done ? Colors.success : Colors.warning ?? "#F59E0B") + "20" }]}>
                              {it.done ? <Check color={Colors.success} size={14} /> : <X color={Colors.warning ?? "#F59E0B"} size={14} />}
                            </View>
                            <Text style={[styles.rowLabel, { color: Colors.textSecondary, width: 100 }]} numberOfLines={2}>{it.name}</Text>
                            <Text style={[styles.rowValue, { color: Colors.text }]} numberOfLines={2}>{it.note || (it.done ? "OK" : "Pending")}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  );
                })()}

                <Text style={[styles.sectionTitle, { color: Colors.text }]}>Delivery Advisor</Text>
                {selected.values.advisorId ? (
                  <View style={[styles.infoCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <Row Colors={Colors} Icon={UserCheck} label="Name" value={String(selected.values.advisorName ?? "—")} />
                    <Row Colors={Colors} Icon={Hash} label="DA #" value={String(selected.values.advisorDaNumber ?? selected.values.advisorId)} />
                    <Row Colors={Colors} Icon={Building2} label="Dealer" value={String(selected.values.advisorDealership ?? "—")} />
                    <Row Colors={Colors} Icon={Phone} label="Contact" value={String(selected.values.advisorContact ?? "—")} />
                    <Row Colors={Colors} Icon={Mail} label="Email" value={String(selected.values.advisorEmail ?? "—")} />
                    <Row
                      Colors={Colors}
                      Icon={MapPin}
                      label="Location"
                      value={`${String(selected.values.advisorCity ?? "")}, ${String(selected.values.advisorState ?? "")}, ${String(selected.values.advisorCountry ?? "")}`}
                    />
                    <TouchableOpacity
                      onPress={() => setAssignVisible(true)}
                      style={[styles.secondaryBtn, { borderColor: Colors.accent }]}
                      testID="order-reassign"
                    >
                      <Text style={[styles.secondaryBtnText, { color: Colors.accent }]}>Reassign DA</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => setAssignVisible(true)}
                    style={[styles.assignCta, { backgroundColor: Colors.accent }]}
                    testID="order-assign"
                  >
                    <UserCheck color={Colors.onAccent} size={18} />
                    <Text style={[styles.assignCtaText, { color: Colors.onAccent }]}>Assign Delivery Advisor</Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.sectionTitle, { color: Colors.text }]}>Update status</Text>
                <View style={styles.statusRow}>
                  {(["pending", "assigned", "in-progress", "delivered"] as const).map((s) => {
                    const sel = String(selected.values.status ?? "pending") === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setOrderStatus(s)}
                        style={[
                          styles.statusBtn,
                          {
                            backgroundColor: sel ? statusColor(s) : Colors.gray[100],
                            borderColor: sel ? statusColor(s) : Colors.border,
                          },
                        ]}
                        testID={`order-status-${s}`}
                      >
                        {sel && <Check color={Colors.onAccent} size={12} />}
                        <Text
                          style={[
                            styles.statusBtnText,
                            { color: sel ? Colors.onAccent : Colors.text },
                          ]}
                        >
                          {statusLabel(s)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Assign DA picker */}
      <Modal
        visible={assignVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAssignVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background, maxHeight: "85%" }]}>
            <View style={[styles.sheetHandle, { backgroundColor: Colors.border }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: Colors.text }]}>Assign Delivery Advisor</Text>
                <Text style={[styles.sheetSub, { color: Colors.textSecondary }]}>
                  Pick from {advisors.length} configured advisor{advisors.length === 1 ? "" : "s"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setAssignVisible(false)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="assign-close"
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 10 }} showsVerticalScrollIndicator={false}>
              {advisors.length === 0 ? (
                <View style={[styles.empty, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                    No DAs configured. Add advisors in Settings → TEKSI EV → Delivery Advisors.
                  </Text>
                </View>
              ) : (
                advisors.map((a) => {
                  const sel = selected?.values.advisorId === a.id;
                  return (
                    <TouchableOpacity
                      key={a.id}
                      onPress={() => assignAdvisor(a)}
                      style={[
                        styles.advisorCard,
                        {
                          backgroundColor: Colors.gray[100],
                          borderColor: sel ? Colors.accent : Colors.border,
                          borderWidth: sel ? 2 : 1,
                        },
                      ]}
                      testID={`assign-${a.id}`}
                    >
                      <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
                        <UserCheck color={Colors.accent} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { color: Colors.text }]}>
                          {String(a.values.name ?? "Advisor")}
                        </Text>
                        <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {String(a.values.dealership ?? "")} · {String(a.values.city ?? "")}, {String(a.values.country ?? "")}
                        </Text>
                        <Text style={[styles.cardMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {String(a.values.daNumber ?? a.id)} · {String(a.values.contact ?? "")}
                        </Text>
                      </View>
                      {sel && <Check color={Colors.accent} size={20} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function GalleryStrip({
  Colors,
  images,
  testIDPrefix,
}: {
  Colors: ReturnType<typeof useColors>;
  images: { uri: string; label: string }[];
  testIDPrefix: string;
}) {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  return (
    <View style={{ gap: 6 }} testID={`${testIDPrefix}-strip`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.galleryRow}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / 124);
          if (idx !== activeIdx && idx >= 0 && idx < images.length) setActiveIdx(idx);
        }}
        scrollEventThrottle={16}
      >
        {images.map((img, i) => (
          <View
            key={`${img.uri}-${i}`}
            style={[styles.galleryItem, { borderColor: i === activeIdx ? Colors.accent : Colors.border }]}
            testID={`${testIDPrefix}-${i}`}
          >
            <Image source={{ uri: img.uri }} style={styles.galleryImg} />
            <View style={[styles.galleryTag, { backgroundColor: Colors.background + "E6" }]}>
              <Text style={[styles.galleryTagText, { color: Colors.text }]}>{img.label}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={[styles.galleryCount, { color: Colors.textSecondary }]}>
        {`${activeIdx + 1} / ${images.length} · ${images[activeIdx]?.label ?? ""}`}
      </Text>
    </View>
  );
}

function Row({
  Colors,
  Icon,
  label,
  value,
}: {
  Colors: ReturnType<typeof useColors>;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "15" }]}>
        <Icon color={Colors.accent} size={14} />
      </View>
      <Text style={[styles.rowLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: Colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
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
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, fontWeight: "700" as const },
  filterCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 9,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  filterCountText: { fontSize: 10, fontWeight: "800" as const },
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  cardTopRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "800" as const },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardMeta: { fontSize: 11, marginTop: 2 },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: "800" as const },
  empty: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 16,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyText: { fontSize: 13, textAlign: "center" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    maxHeight: "92%" as const,
  },
  sheetHandle: {
    alignSelf: "center" as const,
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800" as const },
  sheetSub: { fontSize: 12, marginTop: 2 },
  statusBig: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: "flex-start" as const,
  },
  statusBigText: { fontSize: 13, fontWeight: "800" as const },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const, marginTop: 16, marginBottom: 8 },
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowLabel: { fontSize: 12, fontWeight: "600" as const, width: 80 },
  rowValue: { flex: 1, fontSize: 13, fontWeight: "700" as const, textAlign: "right" as const },
  assignCta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
  },
  assignCtaText: { fontSize: 15, fontWeight: "800" as const },
  secondaryBtn: {
    marginVertical: 10,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "800" as const },
  statusRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  statusBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBtnText: { fontSize: 12, fontWeight: "700" as const },
  refitBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 8,
  },
  refitBadgeText: { flex: 1, fontSize: 12, fontWeight: "700" as const },
  refitPill: {
    alignSelf: "flex-start" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 6,
  },
  refitPillText: { fontSize: 10, fontWeight: "800" as const },
  galleryRow: { gap: 8, paddingVertical: 4 },
  galleryItem: {
    width: 116,
    height: 84,
    borderRadius: 12,
    borderWidth: 2,
    overflow: "hidden" as const,
    position: "relative" as const,
  },
  galleryImg: { width: "100%" as const, height: "100%" as const },
  galleryTag: {
    position: "absolute" as const,
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  galleryTagText: { fontSize: 10, fontWeight: "700" as const },
  galleryCount: { fontSize: 11, fontWeight: "600" as const, marginTop: 2 },
  ownerDocsRow: {
    flexDirection: "row" as const,
    gap: 8,
    paddingVertical: 10,
  },
  ownerDoc: {
    width: 140,
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden" as const,
    position: "relative" as const,
  },
  ownerDocImg: { width: "100%" as const, height: "100%" as const },
  advisorCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
});
