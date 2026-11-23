import { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function ConnectAccountsRoute() {
  // This route is only reachable once server-side onboarding is completed
  // (the guard sends unfinished setup to `/setup`), so a back button pointing
  // at `/setup` used to land merchants in the *edit* form — business info
  // only, no channel step — and `navigateBack` is a `router.replace`, which
  // wiped the connection screen from the stack. Both exits now agree with the
  // "أكمل لاحقًا" button inside the screen: back to the dashboard, where the
  // "خطوات البدء" checklist keeps guiding.
  return (
    <SourcesScreen
      initialView="onboarding"
      back={{ href: "/(tabs)", label: "العودة إلى لوحة التحكم" }}
    />
  );
}
