import '../services/network_service.dart';
import 'package:flutter/foundation.dart';

/// API Configuration and Constants
/// 
/// ARQUITECTURA PROFESIONAL PARA PRODUCCIÓN:
/// - La app se usa desde CUALQUIER LUGAR (rutas de reparto, oficinas, etc.)
/// - SIEMPRE usa https://api.mari-pepa.com en producción
/// - Solo en desarrollo se permite LAN/local
enum ApiEnvironment { 
  development,  // Solo para debugging en oficina
  production,   // Para todos los comerciales (default)
}

class ApiConfig {
  // =============================================================================
  // CONFIGURACIÓN POR DEFECTO: PRODUCCIÓN
  // =============================================================================
  // Los comerciales usan la app desde cualquier lugar → SIEMPRE producción
  static ApiEnvironment _currentEnvironment = ApiEnvironment.production;

  // -----------------------------------------------------------------------------
  // PRODUCCION (Cloudflare Named Tunnel — dominio fijo permanente)
  // Accesible desde cualquier lugar con internet
  // -----------------------------------------------------------------------------
  static String _productionUrl = 'https://api.mari-pepa.com';
  static const int _serverPort = 3334;

  // -----------------------------------------------------------------------------
  // DESARROLLO (solo para testing en oficina)
  // -----------------------------------------------------------------------------
  static String _developmentIp = '192.168.1.52';

  // =============================================================================
  // MÉTODOS PÚBLICOS
  // =============================================================================

  /// Indica si el servicio de red está inicializado
  static bool get isNetworkReady => NetworkService.isInitialized;

  /// Inicializa la configuración de red
  /// En producción: Usa directamente api.mari-pepa.com
  /// En desarrollo: Detecta automáticamente
  static Future<void> initialize() async {
    if (_currentEnvironment == ApiEnvironment.production) {
      // PRODUCCIÓN: Usar directamente el dominio
      print('🚀 [ApiConfig] PRODUCCIÓN: $_productionUrl');
    } else {
      // DESARROLLO: Detectar servidor
      await NetworkService.initialize();
      print('🚀 [ApiConfig] DESARROLLO: ${NetworkService.activeBaseUrl}');
    }
  }

  /// Obtiene la URL base activa
  static String get baseUrl {
    if (_currentEnvironment == ApiEnvironment.production) {
      return _productionUrl.endsWith('/api') 
          ? _productionUrl 
          : '$_productionUrl/api';
    }
    // Desarrollo: usar detección automática
    return NetworkService.activeBaseUrl;
  }

  /// Cambia el entorno en runtime (solo para debugging)
  static void setEnvironment(ApiEnvironment env) {
    _currentEnvironment = env;
  }

  /// Fuerza el uso de producción (útil para testing)
  static void setProduction() {
    _currentEnvironment = ApiEnvironment.production;
  }

  /// Fuerza el uso de desarrollo (útil para testing en oficina)
  static void setDevelopment() {
    _currentEnvironment = ApiEnvironment.development;
  }

  /// Obtiene diagnósticos de red
  static Future<Map<String, dynamic>> getNetworkDiagnostics() async {
    if (_currentEnvironment == ApiEnvironment.production) {
      return {
        'environment': 'production',
        'baseUrl': baseUrl,
        'isReady': true,
      };
    }
    return await NetworkService.getDiagnostics();
  }

  /// Actualiza la URL de producción (solo si es necesario)
  static void setProductionUrl(String url) {
    _productionUrl = url;
  }

  /// Refresca la conexión (para cuando cambia la red)
  static Future<void> refreshConnection() async {
    await NetworkService.initialize();
  }

  /// Fuerza un servidor manualmente (solo debug)
  static Future<bool> setServerManually(String baseUrl) async {
    if (!kDebugMode) return false; // Solo en debug
    // En producción, siempre usa productionUrl
    return false;
  }

  // =============================================================================
  // ENDPOINTS DE LA API
  // =============================================================================
  
  // Auth Endpoints
  static const String login = '/auth/login';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';

  // Dashboard Endpoints
  static const String dashboardMetrics = '/dashboard/metrics';
  static const String recentSales = '/dashboard/recent-sales';
  static const String salesEvolution = '/dashboard/sales-evolution';
  static const String yoyComparison = '/analytics/yoy-comparison';
  static const String matrixData = '/dashboard/matrix-data';

  // Clients Endpoints
  static const String clientsList = '/clients';
  static const String clientDetail = '/clients';

  // Router (Rutero) Endpoints
  static const String routerCalendar = '/router/calendar';
  static const String ruteroWeek = '/rutero/week';
  static const String ruteroDay = '/rutero/day';
  static const String ruteroConfig = '/rutero/config';
  static const String ruteroClientStatus = '/rutero/client';
  static const String ruteroClientDetail = '/rutero/client';
  static const String ruteroCounts = '/rutero/counts';
  static const String ruteroPositions = '/rutero/positions';
  static const String ruteroMoveClients = '/rutero/move_clients';
  static const String ruteroVendedores = '/rutero/vendedores';

  // Objectives Endpoints
  static const String objectives = '/objectives';
  static const String objectivesByClient = '/objectives/by-client';
  static const String objectivesEvolution = '/objectives/evolution';
  static const String clientMatrix = '/objectives/client-matrix';
  static const String objectivesPopulations = '/objectives/populations';

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

  // Pedidos Endpoints
  static const String pedidosList = '/pedidos';
  static const String pedidosCreate = '/pedidos/create';
  static const String pedidosProducts = '/pedidos/products';
  static const String pedidosRecommendations = '/pedidos/recommendations';
  static const String pedidosPromotions = '/pedidos/promotions';
  static const String pedidosClientBalance = '/pedidos/client-balance';
  static const String pedidosFamilies = '/pedidos/families';
  static const String pedidosBrands = '/pedidos/brands';

  // Commissions Endpoints
  static const String commissionsSummary = '/commissions/summary';
  static const String commissionsYears = '/commissions/years';

  // KPI Alerts Endpoints
  static const String kpiAlerts = '/kpi/alerts';
  static const String kpiDashboard = '/kpi/dashboard';
  static const String kpiEtl = '/kpi/etl';
  static const String kpiHealth = '/kpi/health';

  // Facturas Endpoints
  static const String facturasList = '/facturas';
  static const String facturasYears = '/facturas/years';
  static const String facturasSummary = '/facturas/summary';

  // Export Endpoints
  static const String exportClientReport = '/export/client-report';

  // Health Check
  static const String health = '/health';
  static const String healthVersionCheck = '/health/version-check';

  // =============================================================================
  // TIMEOUTS
  // =============================================================================
  static const Duration connectTimeout = Duration(seconds: 30);
  static const Duration receiveTimeout = Duration(seconds: 60); // Más largo para producción

  // =============================================================================
  // DATE RANGE
  // =============================================================================
  static int get currentYear => DateTime.now().year;
  static int get minYear => currentYear - 2;
  static List<int> get availableYears => [currentYear, currentYear - 1, currentYear - 2];

  // =============================================================================
  // PAGINATION
  // =============================================================================
  static const int defaultPageSize = 50;
  static const int maxPageSize = 200;
}
