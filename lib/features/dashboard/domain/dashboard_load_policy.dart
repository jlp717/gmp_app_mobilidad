/// First-paint policy for the sales dashboard (JEFE_VENTAS path).
///
/// The live panel is DashboardContent, not dashboardProvider. Opening as
/// jefe with hierarchy vendor+client and ALL vendors materializes ~1000
/// vendor×client×month rows on a phone. Default to vendor-only; the
/// HierarchySelector still lets the user add client/product on demand.
library;

/// True for JEFE_VENTAS and ADMIN — same cold-start policy as dashboard UI.
bool isDashboardManagerRole({
  required bool isJefeVentas,
  required String role,
}) {
  final normalized = role.trim().toUpperCase();
  return isJefeVentas || normalized == 'ADMIN' || normalized == 'JEFE_VENTAS';
}

/// Default matrix hierarchy when the user has not customized it.
List<String> defaultDashboardHierarchy({required bool isJefeVentas}) {
  if (isJefeVentas) return const ['vendor'];
  return const ['vendor', 'client'];
}

/// FETCH FIRST sent to /dashboard/matrix-data. Depth 1 is vendors×months.
int dashboardMatrixRowLimit(List<String> hierarchy) {
  if (hierarchy.length <= 1) return 240;
  if (hierarchy.length == 2) return 500;
  return 1000;
}

/// Canonical `months` query value for the matrix endpoint.
String dashboardMonthsQuery(Set<int> months) {
  final sorted = months.where((month) => month >= 1 && month <= 12).toList()
    ..sort();
  return sorted.join(',');
}
