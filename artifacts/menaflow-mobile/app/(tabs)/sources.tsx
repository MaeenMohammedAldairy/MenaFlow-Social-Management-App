import { Redirect, useLocalSearchParams } from "expo-router";

export { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function SourcesRoute() {
  const { connect, reconnect, view } = useLocalSearchParams<{
    connect?: string;
    reconnect?: string;
    view?: string;
  }>();

  return (
    <Redirect
      href={{
        pathname: "/(tabs)/more/sources",
        params: {
          ...(connect ? { connect } : {}),
          ...(reconnect ? { reconnect } : {}),
          ...(view ? { view } : {}),
        },
      }}
    />
  );
}
