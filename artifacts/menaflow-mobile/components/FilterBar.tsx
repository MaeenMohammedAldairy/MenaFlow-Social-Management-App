import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { formatArabicNumber } from "@/lib/formatting";

/**
 * Sticky search + filter row that sits above a list, so filtering stays
 * reachable while the screen header scrolls away.
 */
export function FilterBar({
  children,
  activeCount,
  onOpenFilters,
}: {
  children: React.ReactNode;
  activeCount: number;
  onOpenFilters: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <View
        style={[
          styles.searchBox,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Icon name="search" size={17} color={colors.mutedForeground} />
        {children}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          activeCount > 0 ? `التصفية، ${activeCount} مطبقة` : "التصفية"
        }
        onPress={onOpenFilters}
        style={({ pressed }) => [
          styles.filterButton,
          {
            backgroundColor: activeCount > 0 ? colors.accent : colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Icon
          name="filter"
          size={17}
          color={activeCount > 0 ? colors.primary : colors.mutedForeground}
        />
        <Text style={[styles.filterButtonLabel, { color: colors.foreground }]}>
          تصفية
        </Text>
        {activeCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text
              style={[styles.badgeText, { color: colors.primaryForeground }]}
            >
              {formatArabicNumber(activeCount)}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Bottom sheet that hosts every filter group for a screen. */
export function FilterSheet({
  visible,
  onClose,
  onClear,
  title = "التصفية",
  confirmLabel = "عرض النتائج",
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onClear?: () => void;
  title?: string;
  confirmLabel?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق التصفية"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              {title}
            </Text>
            {onClear ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="مسح كل التصفية"
                onPress={onClear}
                hitSlop={8}
              >
                <Text style={[styles.clearLabel, { color: colors.primary }]}>
                  مسح الكل
                </Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <ActionButton label={confirmLabel} icon="check" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** One titled row of selectable chips, optionally with counts. */
export function FilterChipGroup({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: Array<{ key: string; label: string; count?: number }>;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
        {title}
      </Text>
      <View style={styles.groupRow}>
        {options.map((option) => {
          const isSelected = option.key === selected;
          const label =
            option.count === undefined
              ? option.label
              : `${option.label} · ${formatArabicNumber(option.count)}`;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={
                option.count === undefined
                  ? option.label
                  : `${option.label}: ${formatArabicNumber(option.count)}`
              }
              onPress={() => onSelect(option.key)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: isSelected
                    ? colors.primary
                    : colors.secondary,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  {
                    color: isSelected
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchBox: {
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  filterButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  filterButtonLabel: { fontSize: 13, fontWeight: "600" },
  badge: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    alignItems: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 12,
    maxHeight: "82%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 16, fontWeight: "700" },
  clearLabel: { fontSize: 13, fontWeight: "600" },
  sheetBody: { gap: 12, paddingBottom: 6 },
  group: { gap: 6 },
  groupLabel: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  chipLabel: { fontSize: 12 },
});
