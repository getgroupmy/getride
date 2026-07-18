import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  ShieldCheck,
  Plus,
  Trash2,
  X,
  Search,
  Lock,
  Pencil,
  UserPlus,
  Save,
  Eye,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { isSupabaseConfigured, supabase } from "@/utils/supabase";
import { useAdminAccess, type AdminAccessRow } from "@/contexts/AdminAccessContext";
import { ADMIN_PAGE_OPTIONS, adminPageLabel } from "@/utils/adminPages";

interface ProfileLite {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface AccessRowJoined extends AdminAccessRow {
  profile?: ProfileLite | null;
}

const PAGE_KEY = "admin-settings-sub-admin";

export default function AdminSettingsSubAdminScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit, isSuper, isLoading: accessLoading } = useAdminAccess();
  const editable = canEdit(PAGE_KEY);

  const [rows, setRows] = useState<AccessRowJoined[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<AccessRowJoined | null>(null);

  // form state
  const [profileQuery, setProfileQuery] = useState<string>("");
  const [profileMatches, setProfileMatches] = useState<ProfileLite[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileLite | null>(null);
  // Per-page access level. Keys present = selected page. '*' is exclusive.
  const [pageLevels, setPageLevels] = useState<Record<string, "read" | "edit">>({ "*": "edit" });
  // Used only when editing an existing single row.
  const [accessLevel, setAccessLevel] = useState<"read" | "edit">("read");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [searchingProfiles, setSearchingProfiles] = useState<boolean>(false);
  const [pageQuery, setPageQuery] = useState<string>("");
  const [pageFilter, setPageFilter] = useState<"all" | "selected" | "unselected" | "read" | "edit">("all");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("admin_access")
        .select(
          "id, profile_id, page, access_level, notes, created_at, updated_at, profile:profiles!admin_access_profile_id_fkey(id, name, email, phone)"
        )
        .order("created_at", { ascending: false });
      if (error) {
        console.log("[subAdmin] load error", error.message);
        Alert.alert("Couldn't load admin access", error.message);
        setRows([]);
      } else {
        // supabase typings return profile as array | object depending on relation cardinality
        const mapped: AccessRowJoined[] = (data ?? []).map((r: any) => ({
          id: r.id,
          profile_id: r.profile_id,
          page: r.page,
          access_level: r.access_level,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
          profile: Array.isArray(r.profile) ? r.profile[0] ?? null : r.profile ?? null,
        }));
        setRows(mapped);
      }
    } catch (e) {
      console.log("[subAdmin] load threw", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadProfiles = useCallback(async (term: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    const t = term.trim();
    try {
      setSearchingProfiles(true);
      let query = supabase.from("profiles").select("id, name, email, phone");
      if (t.length >= 1) {
        // UUID exact match if it looks like one, otherwise ilike across fields
        const looksLikeUuid = /^[0-9a-f-]{8,}$/i.test(t);
        if (looksLikeUuid) {
          query = query.or(`name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%,id.eq.${t}`);
        } else {
          query = query.or(`name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`);
        }
      }
      const { data, error } = await query.order("name", { ascending: true, nullsFirst: false }).limit(50);
      if (error) {
        console.log("[subAdmin] profile search error", error.message);
        setProfileMatches([]);
      } else {
        setProfileMatches((data ?? []) as ProfileLite[]);
      }
    } catch (e) {
      console.log("[subAdmin] profile search threw", e);
    } finally {
      setSearchingProfiles(false);
    }
  }, []);

  useEffect(() => {
    if (!showForm || editing) return;
    const t = setTimeout(() => {
      void loadProfiles(profileQuery);
    }, 200);
    return () => clearTimeout(t);
  }, [profileQuery, loadProfiles, showForm, editing]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setProfileQuery("");
    setProfileMatches([]);
    setSelectedProfile(null);
    setPageLevels({ "*": "edit" });
    setAccessLevel("read");
    setNotes("");
    setPageQuery("");
    setPageFilter("all");
  }, []);

  const openAdd = useCallback(() => {
    if (!editable) return;
    resetForm();
    setShowForm(true);
  }, [editable, resetForm]);

  const openEdit = useCallback(
    (row: AccessRowJoined) => {
      if (!editable) return;
      setEditing(row);
      setSelectedProfile(
        row.profile ?? {
          id: row.profile_id,
          name: null,
          email: null,
          phone: null,
        }
      );
      setProfileQuery("");
      setProfileMatches([]);
      setPageLevels({ [row.page]: row.access_level });
      setAccessLevel(row.access_level);
      setNotes(row.notes ?? "");
      setShowForm(true);
    },
    [editable]
  );

  const submit = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      Alert.alert("Supabase not configured");
      return;
    }
    if (!selectedProfile) {
      Alert.alert("Select a profile", "Search and pick a profile to grant access to.");
      return;
    }
    const entries = Object.entries(pageLevels).filter(([k]) => k.trim().length > 0);
    if (entries.length === 0) {
      Alert.alert("Page required", "Pick at least one page (or '*' for all pages).");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        // Editing affects only the single existing row.
        const [page, lvl] = entries[0];
        const { error } = await supabase
          .from("admin_access")
          .update({
            page,
            access_level: lvl,
            notes: notes.trim() || null,
          })
          .eq("id", editing.id);
        if (error) {
          Alert.alert("Couldn't update", error.message);
          return;
        }
      } else {
        // If '*' is selected it's exclusive — only that row needs to be written.
        const finalEntries = pageLevels["*"] ? [["*", pageLevels["*"]] as const] : entries;
        const rowsToInsert = finalEntries.map(([p, lvl]) => ({
          profile_id: selectedProfile.id,
          page: p,
          access_level: lvl,
          notes: notes.trim() || null,
        }));
        // upsert so existing (profile_id, page) pairs are updated instead of erroring.
        let { error } = await supabase
          .from("admin_access")
          .upsert(rowsToInsert, { onConflict: "profile_id,page" });
        if (error) {
          // 0069 lockdown: admin_access writes require sub-admin edit access.
          // On a fresh install nobody has it yet — the bootstrap RPC makes the
          // first authenticated caller the '*' admin, then the write retries.
          const { data: bootstrapped } = await supabase.rpc("admin_access_bootstrap");
          if (bootstrapped === true) {
            ({ error } = await supabase
              .from("admin_access")
              .upsert(rowsToInsert, { onConflict: "profile_id,page" }));
          }
        }
        if (error) {
          Alert.alert("Couldn't grant access", error.message);
          return;
        }
      }
      setShowForm(false);
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }, [editing, selectedProfile, pageLevels, notes, load, resetForm]);

  const onDelete = useCallback(
    (row: AccessRowJoined) => {
      if (!editable) return;
      const apply = async () => {
        if (!isSupabaseConfigured || !supabase) return;
        const { error } = await supabase.from("admin_access").delete().eq("id", row.id);
        if (error) {
          Alert.alert("Couldn't delete", error.message);
          return;
        }
        await load();
      };
      Alert.alert(
        "Revoke access",
        `Remove ${row.profile?.name ?? row.profile_id.slice(0, 8)}'s access to ${row.page}?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Revoke", style: "destructive", onPress: apply },
        ]
      );
    },
    [editable, load]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.profile?.name,
        r.profile?.email,
        r.profile?.phone,
        r.profile_id,
        r.page,
        r.access_level,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  const pageLabel = useCallback((p: string) => adminPageLabel(p), []);

  // Tapping a page pill cycles: off -> read -> edit -> off.
  // '*' is exclusive (selecting it clears all others; selecting another clears '*').
  const cyclePage = useCallback((key: string) => {
    setPageLevels((prev) => {
      const current = prev[key];
      const next: "read" | "edit" | undefined =
        current === undefined ? "read" : current === "read" ? "edit" : undefined;
      if (key === "*") {
        // Selecting '*' wipes everything else.
        if (next === undefined) {
          const { ["*"]: _omit, ...rest } = prev;
          return rest;
        }
        return { "*": next };
      }
      const { ["*"]: _wild, ...rest } = prev;
      if (next === undefined) {
        const { [key]: _omit, ...without } = rest;
        return without;
      }
      return { ...rest, [key]: next };
    });
  }, []);

  const allNonWildcardKeys = useMemo(
    () => ADMIN_PAGE_OPTIONS.filter((o) => o.key !== "*").map((o) => o.key),
    []
  );

  const setAllLevel = useCallback(
    (lvl: "read" | "edit") => {
      setPageLevels(() => {
        const next: Record<string, "read" | "edit"> = {};
        for (const k of allNonWildcardKeys) next[k] = lvl;
        return next;
      });
    },
    [allNonWildcardKeys]
  );

  const clearAllPages = useCallback(() => {
    setPageLevels({});
  }, []);

  const selectedCount = Object.keys(pageLevels).length;
  const isAllWildcard = pageLevels["*"] !== undefined;

  const visiblePageOptions = useMemo(() => {
    const q = pageQuery.trim().toLowerCase();
    return ADMIN_PAGE_OPTIONS.filter((opt) => {
      if (q) {
        const hay = `${opt.key} ${opt.label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const lvl = pageLevels[opt.key];
      switch (pageFilter) {
        case "selected":
          return lvl !== undefined;
        case "unselected":
          return lvl === undefined;
        case "read":
          return lvl === "read";
        case "edit":
          return lvl === "edit";
        default:
          return true;
      }
    });
  }, [pageQuery, pageFilter, pageLevels]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="sub-admin-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <ShieldCheck color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Sub Admins</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {rows.length} access {rows.length === 1 ? "rule" : "rules"} ·{" "}
            {editable ? (isSuper ? "super admin" : "edit") : "read-only"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          disabled={!editable}
          style={[
            styles.iconBtn,
            { backgroundColor: editable ? Colors.accent + "20" : Colors.gray[100], opacity: editable ? 1 : 0.5 },
          ]}
          testID="sub-admin-add"
        >
          <Plus color={editable ? Colors.accent : Colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      {accessLoading || loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {!editable ? (
            <View
              style={[
                styles.banner,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <Lock color={Colors.textSecondary} size={14} />
              <Text style={[styles.bannerText, { color: Colors.textSecondary }]}>
                You have read-only access to this page. Ask a super-admin to grant edit access.
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.searchRow,
              { borderColor: Colors.border, backgroundColor: Colors.gray[100] },
            ]}
          >
            <Search color={Colors.textSecondary} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, email, phone or page..."
              placeholderTextColor={Colors.textSecondary}
              style={[styles.searchInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="sub-admin-search"
            />
          </View>

          {filtered.map((row) => {
            const initials =
              (row.profile?.name ?? "?")
                .split(/\s+/)
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase() || "?";
            const isEditLevel = row.access_level === "edit";
            return (
              <View
                key={row.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`sub-admin-row-${row.id}`}
              >
                <View style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}>
                  <Text style={[styles.avatarTxt, { color: Colors.accent }]}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
                    {row.profile?.name ?? "Unnamed"}
                  </Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {row.profile?.email ?? row.profile?.phone ?? row.profile_id}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: Colors.background,
                          borderColor: Colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.badgeTxt, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {pageLabel(row.page)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isEditLevel ? Colors.accent : Colors.background,
                          borderColor: isEditLevel ? Colors.accent : Colors.border,
                        },
                      ]}
                    >
                      {isEditLevel ? (
                        <Pencil color={Colors.onAccent} size={10} />
                      ) : (
                        <Eye color={Colors.textSecondary} size={10} />
                      )}
                      <Text
                        style={[
                          styles.badgeTxt,
                          { color: isEditLevel ? Colors.onAccent : Colors.textSecondary },
                        ]}
                      >
                        {row.access_level}
                      </Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(row)}
                  disabled={!editable}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background, opacity: editable ? 1 : 0.4 }]}
                  testID={`sub-admin-edit-${row.id}`}
                  hitSlop={8}
                >
                  <Pencil color={Colors.accent} size={14} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(row)}
                  disabled={!editable}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background, opacity: editable ? 1 : 0.4 }]}
                  testID={`sub-admin-delete-${row.id}`}
                  hitSlop={8}
                >
                  <Trash2 color={Colors.error} size={14} />
                </TouchableOpacity>
              </View>
            );
          })}

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>
                {query ? `No matches for "${query}".` : "No sub-admins yet. Tap + to grant access."}
              </Text>
            </View>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit access" : "Grant access"}
                </Text>
                <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
                  <X color={Colors.text} size={22} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
                {/* Profile picker */}
                {editing ? (
                  <View
                    style={[
                      styles.profileCard,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <UserPlus color={Colors.accent} size={16} />
                    <Text style={[styles.profileName, { color: Colors.text }]} numberOfLines={1}>
                      {selectedProfile?.name ?? "Profile"}
                    </Text>
                    <Text style={[styles.profileSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {selectedProfile?.email ?? selectedProfile?.phone ?? selectedProfile?.id}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Profile</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Search color={Colors.textSecondary} size={16} />
                      <TextInput
                        value={profileQuery}
                        onChangeText={(t) => {
                          setProfileQuery(t);
                          setSelectedProfile(null);
                        }}
                        placeholder="Name, email, phone, or UUID"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="sub-admin-form-profile-search"
                      />
                      {searchingProfiles ? <ActivityIndicator color={Colors.accent} size="small" /> : null}
                    </View>
                    {selectedProfile ? (
                      <View
                        style={[
                          styles.profileCard,
                          { backgroundColor: Colors.accent + "15", borderColor: Colors.accent },
                        ]}
                      >
                        <View style={styles.selectedHeader}>
                          <UserPlus color={Colors.accent} size={16} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.profileName, { color: Colors.text }]} numberOfLines={1}>
                              {selectedProfile.name ?? "Unnamed"}
                            </Text>
                            <Text style={[styles.profileSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                              {selectedProfile.email ?? selectedProfile.phone ?? selectedProfile.id}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => {
                              setSelectedProfile(null);
                              setProfileQuery("");
                            }}
                            hitSlop={8}
                            testID="sub-admin-clear-profile"
                          >
                            <X color={Colors.textSecondary} size={16} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.matchList}>
                        {profileMatches.length === 0 && !searchingProfiles ? (
                          <Text style={[styles.matchSub, { color: Colors.textSecondary, paddingVertical: 10, textAlign: "center" as const }]}>
                            {profileQuery.trim() ? `No profiles match "${profileQuery}"` : "No profiles found."}
                          </Text>
                        ) : null}
                        {profileMatches.map((p) => {
                          const initials =
                            (p.name ?? "?")
                              .split(/\s+/)
                              .map((s) => s[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")
                              .toUpperCase() || "?";
                          return (
                            <TouchableOpacity
                              key={p.id}
                              onPress={() => {
                                setSelectedProfile(p);
                                setProfileQuery(p.name ?? p.email ?? p.phone ?? p.id);
                              }}
                              style={[
                                styles.matchRow,
                                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                              ]}
                              testID={`sub-admin-match-${p.id}`}
                            >
                              <View style={[styles.matchAvatar, { backgroundColor: Colors.accent + "20" }]}>
                                <Text style={[styles.matchAvatarTxt, { color: Colors.accent }]}>{initials}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.matchName, { color: Colors.text }]} numberOfLines={1}>
                                  {p.name ?? "Unnamed"}
                                </Text>
                                <Text style={[styles.matchSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                                  {p.email ?? p.phone ?? p.id}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}

                <View style={styles.pageHeaderRow}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 14, marginBottom: 0 }]}>
                    {editing
                      ? "Page & access level"
                      : `Pages (${isAllWildcard ? "all" : selectedCount} selected)`}
                  </Text>
                </View>

                {editing ? (
                  <>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 6 },
                      ]}
                    >
                      <Search color={Colors.textSecondary} size={14} />
                      <TextInput
                        value={pageQuery}
                        onChangeText={setPageQuery}
                        placeholder="Search pages..."
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="sub-admin-page-search-edit"
                      />
                      {pageQuery ? (
                        <TouchableOpacity onPress={() => setPageQuery("")} hitSlop={8}>
                          <X color={Colors.textSecondary} size={14} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={styles.pageGrid}>
                      {visiblePageOptions.length === 0 ? (
                        <Text style={[styles.helperTxt, { color: Colors.textSecondary }]}>
                          No pages match "{pageQuery}".
                        </Text>
                      ) : null}
                      {visiblePageOptions.map((opt) => {
                        const active = pageLevels[opt.key] !== undefined;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            onPress={() => setPageLevels({ [opt.key]: accessLevel })}
                            style={[
                              styles.pagePill,
                              {
                                backgroundColor: active ? Colors.accent : Colors.gray[100],
                                borderColor: active ? Colors.accent : Colors.border,
                              },
                            ]}
                            testID={`sub-admin-page-${opt.key}`}
                          >
                            <Text
                              style={[
                                styles.pagePillTxt,
                                { color: active ? Colors.onAccent : Colors.text },
                              ]}
                              numberOfLines={1}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 14 }]}>Access level</Text>
                    <View style={styles.levelRow}>
                      {(["read", "edit"] as const).map((lvl) => {
                        const active = accessLevel === lvl;
                        return (
                          <TouchableOpacity
                            key={lvl}
                            onPress={() => {
                              setAccessLevel(lvl);
                              // Re-apply the new level to the single selected page.
                              const sel = Object.keys(pageLevels)[0];
                              if (sel) setPageLevels({ [sel]: lvl });
                            }}
                            style={[
                              styles.levelBtn,
                              {
                                backgroundColor: active ? Colors.accent : Colors.gray[100],
                                borderColor: active ? Colors.accent : Colors.border,
                              },
                            ]}
                            testID={`sub-admin-level-${lvl}`}
                          >
                            {lvl === "edit" ? (
                              <Pencil color={active ? Colors.onAccent : Colors.text} size={14} />
                            ) : (
                              <Eye color={active ? Colors.onAccent : Colors.text} size={14} />
                            )}
                            <Text
                              style={[
                                styles.levelTxt,
                                { color: active ? Colors.onAccent : Colors.text },
                              ]}
                            >
                              {lvl === "edit" ? "Edit" : "Read-only"}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.helperTxt, { color: Colors.textSecondary }]}>
                      Tap a page to cycle: off → read-only → edit → off. Use the quick actions to bulk-assign.
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 6 },
                      ]}
                    >
                      <Search color={Colors.textSecondary} size={14} />
                      <TextInput
                        value={pageQuery}
                        onChangeText={setPageQuery}
                        placeholder="Search pages..."
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="sub-admin-page-search"
                      />
                      {pageQuery ? (
                        <TouchableOpacity onPress={() => setPageQuery("")} hitSlop={8}>
                          <X color={Colors.textSecondary} size={14} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.filterRow}
                    >
                      {([
                        { key: "all", label: "All" },
                        { key: "selected", label: `Selected (${selectedCount})` },
                        { key: "unselected", label: "Unselected" },
                        { key: "edit", label: "Edit only" },
                        { key: "read", label: "Read only" },
                      ] as const).map((f) => {
                        const active = pageFilter === f.key;
                        return (
                          <TouchableOpacity
                            key={f.key}
                            onPress={() => setPageFilter(f.key)}
                            style={[
                              styles.filterChip,
                              {
                                backgroundColor: active ? Colors.accent : Colors.gray[100],
                                borderColor: active ? Colors.accent : Colors.border,
                              },
                            ]}
                            testID={`sub-admin-page-filter-${f.key}`}
                          >
                            <Text
                              style={[
                                styles.filterChipTxt,
                                { color: active ? Colors.onAccent : Colors.text },
                              ]}
                            >
                              {f.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <View style={styles.quickRow}>
                      <TouchableOpacity
                        onPress={() => setAllLevel("read")}
                        style={[styles.quickBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                        testID="sub-admin-all-read"
                      >
                        <Eye color={Colors.text} size={12} />
                        <Text style={[styles.quickTxt, { color: Colors.text }]}>All read</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setAllLevel("edit")}
                        style={[styles.quickBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                        testID="sub-admin-all-edit"
                      >
                        <Pencil color={Colors.text} size={12} />
                        <Text style={[styles.quickTxt, { color: Colors.text }]}>All edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={clearAllPages}
                        style={[styles.quickBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                        testID="sub-admin-clear-all"
                      >
                        <X color={Colors.text} size={12} />
                        <Text style={[styles.quickTxt, { color: Colors.text }]}>Clear</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.pageGrid}>
                      {visiblePageOptions.length === 0 ? (
                        <Text style={[styles.helperTxt, { color: Colors.textSecondary }]}>
                          No pages match this filter.
                        </Text>
                      ) : null}
                      {visiblePageOptions.map((opt) => {
                        const lvl = pageLevels[opt.key];
                        const active = lvl !== undefined;
                        const isEditLvl = lvl === "edit";
                        const bg = !active
                          ? Colors.gray[100]
                          : isEditLvl
                            ? Colors.accent
                            : Colors.accent + "30";
                        const fg = !active
                          ? Colors.text
                          : isEditLvl
                            ? Colors.onAccent
                            : Colors.text;
                        const border = active
                          ? isEditLvl
                            ? Colors.accent
                            : Colors.accent
                          : Colors.border;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            onPress={() => cyclePage(opt.key)}
                            style={[
                              styles.pagePill,
                              styles.pagePillRow,
                              { backgroundColor: bg, borderColor: border },
                            ]}
                            testID={`sub-admin-page-${opt.key}`}
                          >
                            {active ? (
                              isEditLvl ? (
                                <Pencil color={fg} size={11} />
                              ) : (
                                <Eye color={fg} size={11} />
                              )
                            ) : null}
                            <Text
                              style={[styles.pagePillTxt, { color: fg }]}
                              numberOfLines={1}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 14 }]}>Notes (optional)</Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border, minHeight: 60, alignItems: "flex-start" as const },
                  ]}
                >
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="e.g. Temporary access during launch"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text, height: 60, textAlignVertical: "top" as const }]}
                    multiline
                    testID="sub-admin-form-notes"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={submit}
                disabled={saving}
                style={[styles.saveBtn, { backgroundColor: Colors.accent, opacity: saving ? 0.7 : 1 }]}
                testID="sub-admin-form-save"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.onAccent} />
                ) : (
                  <>
                    <Save color={Colors.onAccent} size={16} />
                    <Text style={[styles.saveTxt, { color: Colors.onAccent }]}>
                      {editing ? "Save changes" : "Grant access"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
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
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  banner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  bannerText: { fontSize: 12, flex: 1 },
  searchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  avatarTxt: { fontSize: 13, fontWeight: "800" as const },
  rowTitle: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  badgeRow: { flexDirection: "row" as const, gap: 6, marginTop: 6, flexWrap: "wrap" as const },
  badge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 11, fontWeight: "700" as const },
  emptyWrap: { alignItems: "center" as const, paddingVertical: 24 },
  emptyTxt: { fontSize: 13, textAlign: "center" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 8,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  profileCard: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    gap: 2,
  },
  profileName: { fontSize: 14, fontWeight: "700" as const },
  profileSub: { fontSize: 12 },
  matchList: { gap: 6, marginTop: 8, maxHeight: 260 },
  matchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  matchAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  matchAvatarTxt: { fontSize: 11, fontWeight: "800" as const },
  matchName: { fontSize: 14, fontWeight: "700" as const },
  matchSub: { fontSize: 12, marginTop: 2 },
  selectedHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  pageHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  linkBtn: { fontSize: 12, fontWeight: "700" as const },
  pageGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 6 },
  pagePill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%" as const,
  },
  pagePillTxt: { fontSize: 12, fontWeight: "700" as const },
  pagePillRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
  },
  helperTxt: { fontSize: 11, marginTop: 6, marginBottom: 4 },
  quickRow: { flexDirection: "row" as const, gap: 6, marginTop: 6, marginBottom: 2 },
  quickBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  quickTxt: { fontSize: 11, fontWeight: "700" as const },
  filterRow: { gap: 6, paddingVertical: 8 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipTxt: { fontSize: 11, fontWeight: "700" as const },
  levelRow: { flexDirection: "row" as const, gap: 8 },
  levelBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  levelTxt: { fontSize: 13, fontWeight: "700" as const },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 12,
  },
  saveTxt: { fontSize: 14, fontWeight: "800" as const },
});
