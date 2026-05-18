/// Feature flags via --dart-define at build time.
///
/// Usage: flutter run --dart-define=NEW_LOAD_PLANNER=true
class FeatureFlags {
  FeatureFlags._();

  static bool get newLoadPlanner =>
      const String.fromEnvironment('NEW_LOAD_PLANNER', defaultValue: 'true') ==
      'true';
}
