/// Centralized cache keys for the application
/// Using structured keys makes invalidation and debugging easier
class CacheKeys {
  // Prevent instantiation
  CacheKeys._();

  // ============================================================
  // Dashboard Cache Keys
  // ============================================================
  
  /// Dashboard metrics (KPIs, totals)
  static const String dashboardMetrics = 'dashboard_metrics';
  
  /// Recent sales list
  static const String recentSales = 'dashboard_recent_sales';
  
  /// Sales evolution chart data
  static const String salesEvolution = 'dashboard_sales_evolution';
  
  /// Year-over-year comparison
  static const String yoyComparison = 'dashboard_yoy_comparison';

  // ============================================================
  // Clients Cache Keys
  // ============================================================
  
  /// Client list prefix (append vendedor code for specific lists)
  static const String clientsListPrefix = 'clients_list_';
  
  /// Build client list key for specific vendedor
  static String clientsList(String vendedorCode) => 
      '$clientsListPrefix$vendedorCode';
  
  /// Client detail prefix (append client code)
  static const String clientDetailPrefix = 'client_detail_';
  
  /// Build client detail key
  static String clientDetail(String clientCode) => 
      '$clientDetailPrefix$clientCode';

  // ============================================================
  // Rutero Cache Keys
  // ============================================================
  
  /// Rutero week data prefix
  static const String ruteroWeekPrefix = 'rutero_week_';
  
  /// Build rutero week key
  static String ruteroWeek(String vendedorCode, int weekOffset) => 
      '$ruteroWeekPrefix${vendedorCode}_$weekOffset';
  
  /// Rutero day data prefix
  static const String ruteroDayPrefix = 'rutero_day_';
  
  /// Build rutero day key
  static String ruteroDay(String vendedorCode, String date) => 
      '$ruteroDayPrefix${vendedorCode}_$date';

  // ============================================================
  // Sales History Cache Keys
  // ============================================================
  
  /// Sales history prefix
  static const String salesHistoryPrefix = 'sales_history_';
  
  /// Build sales history key for client
  static String salesHistory(String clientCode) => 
      '$salesHistoryPrefix$clientCode';

  // ============================================================
  // Analytics Cache Keys
  // ============================================================
  
  /// Top products analytics
  static const String topProducts = 'analytics_top_products';
  
  /// Top clients analytics
  static const String topClients = 'analytics_top_clients';
  
  /// Objectives matrix
  static const String objectivesMatrix = 'objectives_matrix';

  // ============================================================
  // User/Auth Cache Keys
  // ============================================================
  
  /// User session data
  static const String userSession = 'user_session';
  
  /// Vendedor codes list
  static const String vendedorCodes = 'vendedor_codes';
}
