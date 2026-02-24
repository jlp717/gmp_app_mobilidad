import '../services/network_service.dart';

/// API Configuration and Constants
/// Ahora usa NetworkService para detección automática de servidor
enum ApiEnvironment { development, production, autoDetect }

class ApiConfig {
  // =============================================================================
  // ENVIRONMENT CONFIGURATION - SENIOR ARCHITECTURE
  // =============================================================================
  
  // MODO AUTOMÁTICO: Detecta el mejor servidor disponible
  // Soporta: Producción, LAN, Emulador, WSA (Windows Subsystem for Android)
  static ApiEnvironment _currentEnvironment = ApiEnvironment.autoDetect;
  
  // -----------------------------------------------------------------------------
  // 1. DESARROLLO (WiFi Local)
  static String _developmentIp = '127.0.0.1';
  static const int _serverPort = 3002;

  // -----------------------------------------------------------------------------
  // 2. PRODUCCION (Cloudflare Named Tunnel — dominio fijo permanente)
  static String _productionUrl = 'https://anonymous-grill-firefox-old.trycloudflare.com'; 

  // =============================================================================

  /// Indica si el servicio de red está inicializado
  static bool get isNetworkReady => NetworkService.isInitialized;

  /// Inicializa la configuración de red (detecta servidor automáticamente)
  static Future<void> initialize() async {
    if (_currentEnvironment == ApiEnvironment.autoDetect) {
      await NetworkService.initialize();
      // LOG CRÍTICO para ver qué servidor se detectó en la tablet
      print('🚀 [ApiConfig] SERVIDOR DETECTADO: ${NetworkService.activeBaseUrl}');
    }
  }

  /// Obtiene la URL base activa
  static String get baseUrl {
    switch (_currentEnvironment) {
      case ApiEnvironment.autoDetect:
        // Usar NetworkService para detección inteligente
        return NetworkService.activeBaseUrl;
      case ApiEnvironment.production:
        return _productionUrl.endsWith('/api') ? _productionUrl : '$_productionUrl/api';
      case ApiEnvironment.development:
        return 'http://$_developmentIp:$_serverPort/api';
    }
  }

  /// Cambia el entorno en runtime
  static void setEnvironment(ApiEnvironment env) {
    _currentEnvironment = env;
  }

  /// Actualiza la URL de producción
  static void setProductionUrl(String url) {
    _productionUrl = url;
  }
  
  /// Actualiza la IP de desarrollo
  static void setDevelopmentIp(String ip) {
    _developmentIp = ip;
  }

  /// Fuerza un servidor específico manualmente
  static Future<bool> setServerManually(String baseUrl) async {
    return await NetworkService.setServer(baseUrl);
  }

  /// Re-detecta el mejor servidor (útil cuando cambia la red)
  static Future<void> refreshConnection() async {
    await NetworkService.refreshConnection();
  }

  /// Obtiene diagnósticos de red para debugging
  static Future<Map<String, dynamic>> getNetworkDiagnostics() async {
    return await NetworkService.getDiagnostics();
  }
  
  // Alternativas para referencia
  static const String emulatorUrl = 'http://10.0.2.2:3002/api';
  static const String wsaUrl = 'http://172.31.192.1:3002/api';


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
  static const String ruteroCounts = '/rutero/counts';
  static const String ruteroPositions = '/rutero/positions';
  static const String ruteroMoveClients = '/rutero/move_clients';

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
