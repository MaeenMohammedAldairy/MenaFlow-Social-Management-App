import { Redirect, useLocalSearchParams } from "expo-router";

export { SourcesScreen } from "@/components/sources/SourcesScreen";

export default function SourcesRoute() {
  const { connect, reconnect, view, returnTo } = useLocalSearchParams<{
    connect?: string;
    reconnect?: string;
    view?: string;
    returnTo?: string;
  }>();

  const isPublishingTarget =
    view === "publishing" ||
    connect === "facebook" ||
    connect === "instagram";

  return (
    <Redirect
      href={{
        pathname: isPublishingTarget
          ? "/(tabs)/more/accounts"
          : "/(tabs)/more/sources",
        params: {
          ...(connect ? { connect } : {}),
          ...(reconnect ? { reconnect } : {}),
          ...(returnTo ? { returnTo } : {}),
        },
      }}
    />
  );
}
