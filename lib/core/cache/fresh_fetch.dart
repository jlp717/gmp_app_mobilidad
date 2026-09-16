/// Skip network refetch on resume/rebuild when the last successful fetch
/// is still inside the given ttl. Pull-to-refresh always passes forceRefresh.
const Duration kDefaultUiFreshness = Duration(minutes: 10);

bool isUiDataFresh(
  DateTime? lastFetch, {
  Duration ttl = kDefaultUiFreshness,
  DateTime? now,
}) {
  if (lastFetch == null) return false;
  return (now ?? DateTime.now()).difference(lastFetch) < ttl;
}
