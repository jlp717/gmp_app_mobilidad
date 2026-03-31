import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Servicio de red inteligente con detección automática de servidor
/// 
/// ARQUITECTURA PROFESIONAL:
/// - PRODUCCIÓN: Siempre usa https://api.mari-pepa.com (Cloudflare Tunnel)
/// - DESARROLLO: Detecta automáticamente el servidor local
/// 
/// Los comerciales usan la app desde cualquier lugar → SIEMPRE producción
/// Solo en desarrollo se prueba LAN/localhost
class NetworkService {
  static const String _prefsKeyActiveServer = 'network_active_server';
  static const String _prefsKeyLastHealthCheck = 'network_last_health_check';

  static String? _activeBaseUrl;
  static bool _isInitialized = false;
  
  // Flag para forzar producción (usado en release builds)
  static bool _forceProduction = !kDebugMode;

  /// URL de producción (Cloudflare Named Tunnel - accesible desde cualquier lugar)
  static const String productionUrl = 'https://api.mari-pepa.com/api';
  
  /// Servidores SOLO para desarrollo (debug)
  /// En producción (release) NUNCA se usan estas IPs
  static final List<ServerConfig> _devServers = [
    // 1. Producción (también disponible en debug para testing)
    ServerConfig(
      name: 'Producción (api.mari-pepa.com)',
      baseUrl: productionUrl,
      priority: 1,
      isSecure: true,
    ),

    // 2. Servidor LAN directo (solo desarrollo en oficina)
    ServerConfig(
      name: 'Servidor Local (LAN)',
      baseUrl: 'http://192.168.1.52:3334/api',
      priority: 2,
      isSecure: false,
      debugOnly: true,
    ),

    // 3. Emulador Android Studio
    ServerConfig(
      name: 'Emulador Android',
      baseUrl: 'http://10.0.2.2:3334/api',
      priority: 3,
      isSecure: false,
      isEmulatorOnly: true,
      debugOnly: true,
    ),

    // 4. WSA (Windows Subsystem for Android)
    ServerConfig(
      name: 'WSA (Windows)',
      baseUrl: 'http://172.31.192.1:3334/api',
      priority: 4,
      isSecure: false,
      isWSAOnly: true,
      debugOnly: true,
    ),

    // 5. Localhost (desarrollo local)
    ServerConfig(
      name: 'Localhost',
      baseUrl: 'http://127.0.0.1:3334/api',
      priority: 5,
      isSecure: false,
      debugOnly: true,
    ),
  ];

  /// Obtiene la URL base activa (con cache)
  /// 
  /// En PRODUCCIÓN (release): Siempre retorna productionUrl
  /// En DESARROLLO (debug): Retorna el mejor servidor detectado
  static String get activeBaseUrl {
    if (_forceProduction || !kDebugMode) {
      return productionUrl;
    }
    return _activeBaseUrl ?? productionUrl;
  }

  /// Indica si el servicio está inicializado
  static bool get isInitialized => _isInitialized;

  /// Inicializa el servicio de red
  /// 
  /// En PRODUCCIÓN: Usa directamente productionUrl
  /// En DESARROLLO: Detecta el mejor servidor disponible
  static Future<void> initialize() async {
    if (_isInitialized) return;

    // =============================================================================
    // PRODUCCIÓN (Release build) - Usar directamente productionUrl
    // =============================================================================
    if (_forceProduction || !kDebugMode) {
      _activeBaseUrl = productionUrl;
      _isInitialized = true;
      debugPrint('[NetworkService] ✅ PRODUCCIÓN: $productionUrl');
      return;
    }

    // =============================================================================
    // DESARROLLO (Debug build) - Detectar mejor servidor
    // =============================================================================
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString(_prefsKeyActiveServer);

      // Si hay un servidor guardado de desarrollo, verificar si funciona
      if (savedUrl != null && savedUrl.isNotEmpty && savedUrl != productionUrl) {
        final isHealthy = await _checkHealth(savedUrl);
        if (isHealthy) {
          _activeBaseUrl = savedUrl;
          _isInitialized = true;
          debugPrint('[NetworkService] ✅ DESARROLLO: Usando servidor guardado: $savedUrl');
          return;
        }
      }

      // Si no hay servidor guardado o no funciona, detectar automáticamente
      await detectBestServer();

    } catch (e) {
      debugPrint('[NetworkService] ⚠️ Error inicializando: $e');
      // Fallback a producción incluso en debug
      _activeBaseUrl = productionUrl;
      _isInitialized = true;
    }
  }

  /// Detecta el mejor servidor disponible probando cada uno en orden
  /// Solo se usa en DESARROLLO. En producción siempre va directo a productionUrl.
  static Future<void> detectBestServer() async {
    debugPrint('[NetworkService] 🔍 Detectando servidor (DEBUG MODE)...');

    for (final server in _devServers) {
      // Skip servidores debug-only si no estamos en debug
      if (server.debugOnly && !kDebugMode) continue;

      // Skip emuladores si no es emulador
      if (server.isEmulatorOnly && !kIsWeb) {
        // Check if running on Android emulator
        final isEmulator = await _isRunningOnEmulator();
        if (!isEmulator) continue;
      }

      final isHealthy = await _checkHealth(server.baseUrl);
      if (isHealthy) {
        _activeBaseUrl = server.baseUrl;
        _isInitialized = true;
        
        // Guardar preferencia
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefsKeyActiveServer, server.baseUrl);
        
        debugPrint('[NetworkService] ✅ Servidor detectado: ${server.name}');
        return;
      }
    }

    // Si ningún servidor funciona, usar producción como fallback
    _activeBaseUrl = productionUrl;
    _isInitialized = true;
    debugPrint('[NetworkService] ⚠️ Fallback a producción: $productionUrl');
  }

  /// Verifica si un servidor está saludable
  static Future<bool> _checkHealth(String baseUrl) async {
    try {
      final url = Uri.parse('${baseUrl.replaceFirst('/api', '')}/api/health');
      final response = await http.get(url).timeout(
        const Duration(seconds: 3),
        onTimeout: () => http.Response('Timeout', 408),
      );

      if (response.statusCode == 200) {
        final body = response.body.toLowerCase();
        return body.contains('ok') || body.contains('success') || body.contains('connected');
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /// Detecta si se está ejecutando en un emulador Android
  static Future<bool> _isRunningOnEmulator() async {
    // En un emulador Android, 10.0.2.2 es localhost
    return await _checkHealth('http://10.0.2.2:3334/api/health');
  }

  /// Fuerza la reconexión al servidor de producción
  /// Útil cuando el usuario cambia de red (WiFi → Datos)
  static Future<bool> forceProductionServer() async {
    debugPrint('[NetworkService] 🔄 Forzando servidor de producción...');
    
    final isHealthy = await _checkHealth(productionUrl);
    if (isHealthy) {
      _activeBaseUrl = productionUrl;
      _forceProduction = true;
      
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKeyActiveServer, productionUrl);
      
      debugPrint('[NetworkService] ✅ Producción forzada: $productionUrl');
      return true;
    }
    
    debugPrint('[NetworkService] ❌ Producción no disponible');
    return false;
  }

  /// Obtiene diagnósticos de red para debugging
  static Future<Map<String, dynamic>> getDiagnostics() async {
    final diagnostics = <String, dynamic>{
      'activeBaseUrl': _activeBaseUrl,
      'isInitialized': _isInitialized,
      'forceProduction': _forceProduction,
      'isDebugMode': kDebugMode,
      'productionUrl': productionUrl,
    };

    // Check health de todos los servidores
    final healthChecks = <String, bool>{};
    for (final server in _devServers) {
      if (server.debugOnly && !kDebugMode) continue;
      healthChecks[server.name] = await _checkHealth(server.baseUrl);
    }
    diagnostics['serverHealth'] = healthChecks;

    return diagnostics;
  }
}

/// Configuración de servidor
class ServerConfig {
  final String name;
  final String baseUrl;
  final int priority;
  final bool isSecure;
  final bool isEmulatorOnly;
  final bool isWSAOnly;
  final bool debugOnly;

  ServerConfig({
    required this.name,
    required this.baseUrl,
    required this.priority,
    this.isSecure = false,
    this.isEmulatorOnly = false,
    this.isWSAOnly = false,
    this.debugOnly = false,
  });
}
