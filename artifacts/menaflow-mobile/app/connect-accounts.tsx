import { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function ConnectAccountsRoute() {
  return <SourcesScreen
    initialView="onboarding"
    back={{ href: { pathname: "/setup", params: { edit: "business" } }, label: "العودة إلى بيانات النشاط" }}
  />;
}
