import { StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon, type LucideIconName } from "@/components/LucideIcon";
import { ActionButton, StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";

export type InboundDeliveryFact = {
  label: string;
  value: string;
};

export type InboundDeliveryIssue = {
  code: string;
  message: string;
  severity: "warning" | "critical";
};

/**
 * Shows whether events actually reach the server.
 *
 * The switch rows on these panels can only say whether a feature is on. When
 * nothing arrives from the provider the merchant sees "enabled" and waits for
 * replies that can never happen, with no way to tell that apart from a slow
 * customer. This card states the observable facts instead: what was last
 * received, how much of it, and — named in Arabic, in order of severity — what
 * has to change, together with the action that fixes it when one exists.
 */
export function InboundDeliveryCard({
  title,
  delivered,
  facts,
  issues,
  action,
}: {
  title: string;
  /** True once at least one event from the provider has been stored. */
  delivered: boolean;
  facts: InboundDeliveryFact[];
  issues: InboundDeliveryIssue[];
  action?: {
    label: string;
    icon: LucideIconName;
    busy?: boolean;
    disabled?: boolean;
    onPress: () => void;
    /** Shown under the button after a successful run. */
    result?: string | null;
    error?: string | null;
  };
}) {
  const colors = useColors();
  const visibleFacts = facts.filter((fact) => fact.value.trim().length > 0);

  return (
    <View
      accessibilityLabel={title}
      style={[
        styles.card,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <Icon
          name={delivered ? "zap" : "wifi-off"}
          size={18}
          color={delivered ? colors.primary : colors.warning}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <StatusPill
          label={delivered ? "يستقبل الأحداث" : "لم يصل شيء بعد"}
          tone={delivered ? "green" : "amber"}
        />
      </View>

      {visibleFacts.length > 0 ? (
        <View style={styles.facts}>
          {visibleFacts.map((fact) => (
            <View key={fact.label} style={styles.factRow}>
              <Text style={[styles.factLabel, { color: colors.mutedForeground }]}>
                {fact.label}
              </Text>
              <Text style={[styles.factValue, { color: colors.foreground }]}>
                {fact.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {issues.length > 0 ? (
        <View style={styles.issues}>
          {issues.map((issue) => {
            const critical = issue.severity === "critical";
            const color = critical ? colors.destructive : colors.warning;
            return (
              <View
                key={issue.code}
                accessibilityRole="alert"
                style={[
                  styles.issueRow,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Icon
                  name={critical ? "alert-circle" : "info"}
                  size={16}
                  color={color}
                />
                <Text style={[styles.issueText, { color }]}>{issue.message}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {action ? (
        <View style={styles.action}>
          <ActionButton
            label={action.busy ? "جارٍ التنفيذ..." : action.label}
            icon={action.busy ? "refresh-cw" : action.icon}
            secondary
            disabled={Boolean(action.disabled) || Boolean(action.busy)}
            onPress={action.onPress}
          />
          {action.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.actionNote, { color: colors.destructive }]}
            >
              {action.error}
            </Text>
          ) : null}
          {action.result ? (
            <Text style={[styles.actionNote, { color: colors.primary }]}>
              {action.result}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: { flex: 1, fontSize: 14, fontWeight: "800", textAlign: "right" },
  facts: { gap: 6 },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  factLabel: { fontSize: 13, textAlign: "right" },
  factValue: { fontSize: 13, fontWeight: "700", textAlign: "left" },
  issues: { gap: 6 },
  issueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  issueText: { flex: 1, fontSize: 13, lineHeight: 20, textAlign: "right" },
  action: { gap: 6, alignItems: "stretch" },
  actionNote: { fontSize: 12.5, lineHeight: 19, textAlign: "right" },
});
