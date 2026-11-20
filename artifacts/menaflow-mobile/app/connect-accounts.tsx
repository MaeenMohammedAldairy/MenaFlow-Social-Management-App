import { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function ConnectAccountsRoute() {
  return <SourcesScreen
    initialView="onboarding"
    back={{ href: "/onboarding", label: "العودة إلى الإعداد الأولي" }}
  />;
}
