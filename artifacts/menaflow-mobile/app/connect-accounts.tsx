import { OwnerGuard } from "@/components/OwnerGuard";
import SourcesScreen from "./(tabs)/sources";

export default function ConnectAccountsRoute() {
  return (
    <OwnerGuard>
      <SourcesScreen initialView="onboarding" />
    </OwnerGuard>
  );
}
