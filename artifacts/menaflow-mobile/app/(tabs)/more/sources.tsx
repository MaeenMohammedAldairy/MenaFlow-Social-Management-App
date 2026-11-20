import { Redirect, useLocalSearchParams } from "expo-router";
import { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function SourcesRoute() {
  const { view, connect, reconnect, returnTo } = useLocalSearchParams<{
    view?: string;
    connect?: string;
    reconnect?: string;
    returnTo?: string;
  }>();

  if (view === "publishing") {
    return (
      <Redirect
        href={{
          pathname: "/(tabs)/more/accounts",
          params: {
            ...(connect ? { connect } : {}),
            ...(reconnect ? { reconnect } : {}),
            ...(returnTo ? { returnTo } : {}),
          },
        }}
      />
    );
  }

  return <SourcesScreen />;
}
