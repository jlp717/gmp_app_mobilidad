/// API Configuration and Constants
enum ApiEnvironment { development, production }

class ApiConfig {
  // =============================================================================
  // ENVIRONMENT CONFIGURATION - SENIOR ARCHITECTURE
  // =============================================================================
  
  // CAMBIAR AQUI PARA CAMBIAR EL MODO DE LA APP
  static ApiEnvironment _currentEnvironment = ApiEnvironment.production;
  
  // -----------------------------------------------------------------------------
  // 1. DESARROLLO (WiFi Local)
  // IP detectada automáticamente
  // Funciona si la tablet está en el mismo WiFi y el Firewall permite puerto 3333
  static String _developmentIp = '127.0.0.1'; // Fallback localhost
  static const int _serverPort = 3333;

  // -----------------------------------------------------------------------------
  // 2. PRODUCCION (4G / Internet / Ngrok)
  // URL pública accesible desde cualquier lugar
  static String _productionUrl = 'https://4b834588165b.ngrok-free.app'; 

  // =============================================================================

  /// Obtiene la URL base activa
  static String get baseUrl {
    switch (_currentEnvironment) {
      case ApiEnvironment.production:
        // Asegurar que no termine en / si ya tiene /api, o ajustar según necesidad
        return _productionUrl.endsWith('/api') ? _productionUrl : '$_productionUrl/api';
      case ApiEnvironment.development:
        return 'http://$_developmentIp:$_serverPort/api';
    }
  }

  /// Cambia el entorno en runtime
  static void setEnvironment(ApiEnvironment env) {
    _currentEnvironment = env;
  }

  /// Actualiza la URL de producción (para Ngrok dinámico)
  static void setProductionUrl(String url) {
    _productionUrl = url;
  }
  
  /// Actualiza la IP de desarrollo
  static void setDevelopmentIp(String ip) {
    _developmentIp = ip;
  }
  
  // Alternativa para emulador Android
  static const String emulatorUrl = 'http://10.0.2.2:3333/api';


  // Auth Endpoints
  static const String login = '/auth/login';

  // Dashboard Endpoints
  static const String dashboardMetrics = '/dashboard/metrics';
  static const String recentSales = '/dashboard/recent-sales';
  static const String salesEvolution = '/dashboard/sales-evolution';
  static const String yoyComparison = '/analytics/yoy-comparison';

  // Clients Endpoints
  static const String clientsList = '/clients';
  static const String clientDetail = '/clients';
  static const String clientCompare = '/clients/compare';
  static const String clientSalesHistory = '/clients';

  // Router (Rutero) Endpoints
  static const String routerCalendar = '/router/calendar';
  static const String ruteroWeek = '/rutero/week';
  static const String ruteroDay = '/rutero/day';
  static const String ruteroClientStatus = '/rutero/client';
  static const String ruteroClientDetail = '/rutero/client';
  static const String ruteroConfig = '/rutero/config';

  // Objectives Endpoints
  static const String objectives = '/objectives';
  static const String objectivesByClient = '/objectives/by-client';
  static const String objectivesEvolution = '/objectives/evolution';
  static const String clientMatrix = '/objectives/matrix';

  // Analytics Endpoints
  static const String topProducts = '/analytics/top-products';
  static const String topClients = '/analytics/top-clients';
  static const String margins = '/analytics/margins';
  static const String trends = '/analytics/trends';

  // Products Endpoints
  static const String productsList = '/products';
  static const String salesHistory = '/sales-history';

  // Vendedores Endpoints
  static const String vendedores = '/vendedores';

  // Export Endpoints
  static const String exportClientReport = '/export/client-report';

  // Health Check
  static const String health = '/health';

  // Timeouts
  static const Duration connectTimeout = Duration(seconds: 30);
  static const Duration receiveTimeout = Duration(seconds: 30);

  // Date range for data filtering (Dynamic: Current and prev 2 years)
  static int get currentYear => DateTime.now().year;
  static int get minYear => currentYear - 2;
  static List<int> get availableYears => [currentYear, currentYear - 1, currentYear - 2];

  // Pagination defaults
  static const int defaultPageSize = 50;
  static const int maxPageSize = 200;
}
