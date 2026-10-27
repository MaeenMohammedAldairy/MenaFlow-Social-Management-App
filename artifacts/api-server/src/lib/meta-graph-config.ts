export function getMetaGraphVersion(): string {
  return (
    process.env.META_GRAPH_VERSION?.trim() ||
    process.env.VITE_META_GRAPH_VERSION?.trim() ||
    process.env.FACEBOOK_GRAPH_VERSION?.trim() ||
    "v26.0"
  );
}
