import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Servicio de red inteligente con detección automática de servidor
/// Soporta: WSA, Emulador Android, Dispositivo físico, Producción
class NetworkService {
  static const String _prefsKeyActiveServer = 'network_active_server';
  static const String _prefsKeyLastHealthCheck = 'network_last_health_check';
  
  static String? _activeBaseUrl;
  static bool _isInitialized = false;
  
  /// Lista de servidores ordenados por prioridad
  /// El sistema probará cada uno en orden hasta encontrar uno que funcione
  static final List<ServerConfig> _servers = [
    // 1. Producción (Cloudflare Named Tunnel — dominio fijo permanente)
    ServerConfig(
      name: 'Producción (api.mari-pepa.com)',
      baseUrl: 'https://api.mari-pepa.com/api',
      priority: 1,
      isSecure: true,
    ),

    // 2. Servidor LAN directo (para red local)
    ServerConfig(
      name: 'Servidor Local (LAN)',
      baseUrl: 'http://192.168.1.238:3334/api',
      priority: 2,
      isSecure: false,
    ),

    // 3. Emulador Android Studio
    ServerConfig(
      name: 'Emulador Android',
      baseUrl: 'http://10.0.2.2:3334/api',
      priority: 3,
      isSecure: false,
      isEmulatorOnly: true,
    ),

    // 4. WSA (Windows Subsystem for Android) - IP especial Hyper-V
    ServerConfig(
      name: 'WSA (Windows)',
      baseUrl: 'http://172.31.192.1:3334/api',
      priority: 4,
      isSecure: false,
      isWSAOnly: true,
    ),

    // 5. Localhost (desarrollo local)
    ServerConfig(
      name: 'Localhost',
      baseUrl: 'http://127.0.0.1:3334/api',
      priority: 5,
      isSecure: false,
    ),
  ];
  
  /// Obtiene la URL base activa (con cache)
  static String get activeBaseUrl {
    return _activeBaseUrl ?? _servers.first.baseUrl;
  }
  
  /// Indica si el servicio está inicializado
  static bool get isInitialized => _isInitialized;
  
  /// Inicializa el servicio de red
  /// Carga la última configuración funcional o detecta automáticamente
  static Future<void> initialize() async {
    if (_isInitialized) return;
    
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString(_prefsKeyActiveServer);
      
      if (savedUrl != null && savedUrl.isNotEmpty) {
        // Verificar si el servidor guardado sigue funcionando
        final isHealthy = await _checkHealth(savedUrl);
        if (isHealthy) {
          _activeBaseUrl = savedUrl;
          _isInitialized = true;
          debugPrint('[NetworkService] ✅ Usando servidor guardado: $savedUrl');
          return;
        }
      }
      
      // Si no hay servidor guardado o no funciona, detectar automáticamente
      await detectBestServer();
      
    } catch (e) {
      debugPrint('[NetworkService] ⚠️ Error inicializando: $e');
      // Usar producción como fallback
      _activeBaseUrl = _servers.first.baseUrl;
      _isInitialized = true;
    }
  }
  
  /// Detecta el mejor servidor disponible probando cada uno en orden
  static Future<String?> detectBestServer({bool saveResult = true}) async {
    debugPrint('[NetworkService] 🔍 Detectando mejor servidor...');
    
    for (final server in _servers) {
      // Saltar servidores específicos de plataforma si no aplica
      if (server.isEmulatorOnly && !_isRunningOnEmulator()) continue;
      if (server.isWSAOnly && !_isRunningOnWSA()) continue;
      
      debugPrint('[NetworkService] Probando: ${server.name} (${server.baseUrl})');
      
      final isHealthy = await _checkHealth(server.baseUrl);
      if (isHealthy) {
        _activeBaseUrl = server.baseUrl;
        _isInitialized = true;
        
        if (saveResult) {
          await _saveActiveServer(server.baseUrl);
        }
        
        debugPrint('[NetworkService] ✅ Servidor activo: ${server.name}');
        return server.baseUrl;
      }
    }
    
    debugPrint('[NetworkService] ❌ Ningún servidor disponible');
    return null;
  }
  
  /// Verifica la salud de un servidor específico
  static Future<bool> _checkHealth(String baseUrl) async {
    try {
      final uri = Uri.parse('$baseUrl/health');
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => http.Response('timeout', 408),
      );
      
      return response.statusCode == 200;
    } catch (e) {
      debugPrint('[NetworkService] Health check failed for $baseUrl: $e');
      return false;
    }
  }
  
  /// Guarda el servidor activo en preferencias
  static Future<void> _saveActiveServer(String url) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKeyActiveServer, url);
      await prefs.setString(_prefsKeyLastHealthCheck, DateTime.now().toIso8601String());
    } catch (e) {
      debugPrint('[NetworkService] Error guardando servidor: $e');
    }
  }
  
  /// Fuerza un nuevo servidor manualmente
  static Future<bool> setServer(String baseUrl) async {
    final isHealthy = await _checkHealth(baseUrl);
    if (isHealthy) {
      _activeBaseUrl = baseUrl;
      await _saveActiveServer(baseUrl);
      return true;
    }
    return false;
  }
  
  /// Agrega un servidor personalizado (WSA con IP detectada, etc)
  static void addCustomServer(String name, String baseUrl, {int priority = 0}) {
    // Insertar al inicio si prioridad es 0, sino ordenar
    _servers.insert(0, ServerConfig(
      name: name,
      baseUrl: baseUrl,
      priority: priority,
      isSecure: baseUrl.startsWith('https'),
    ));
  }
  
  /// Obtiene la lista de servidores disponibles
  static List<ServerConfig> get availableServers => List.unmodifiable(_servers);
  
  /// Obtiene el servidor actualmente activo
  static ServerConfig? get activeServer {
    try {
      return _servers.firstWhere((s) => s.baseUrl == _activeBaseUrl);
    } catch (_) {
      return null;
    }
  }
  
  /// Re-detecta el servidor (útil cuando cambia la red)
  static Future<void> refreshConnection() async {
    _isInitialized = false;
    _activeBaseUrl = null;
    await initialize();
  }
  
  /// Detecta si estamos en un emulador Android
  static bool _isRunningOnEmulator() {
    // En release mode, asumimos que no es emulador
    if (kReleaseMode) return false;
    
    // Heurística simple: si hay ciertos archivos del emulador
    try {
      return Platform.isAndroid && !kReleaseMode;
    } catch (_) {
      return false;
    }
  }
  
  /// Detecta si estamos en WSA (Windows Subsystem for Android)
  static bool _isRunningOnWSA() {
    try {
      if (!Platform.isAndroid) return false;
      
      // WSA tiene características únicas que podemos detectar
      // Por ejemplo, el modelo del dispositivo contiene "Subsystem"
      // Pero es difícil de detectar con certeza, así que lo probamos siempre
      return true; // Probar siempre la IP de WSA
    } catch (_) {
      return false;
    }
  }
  
  /// Obtiene información de diagnóstico de red
  static Future<Map<String, dynamic>> getDiagnostics() async {
    final results = <String, dynamic>{};
    
    results['activeServer'] = _activeBaseUrl;
    results['isInitialized'] = _isInitialized;
    results['platform'] = Platform.operatingSystem;
    
    // Probar cada servidor
    final serverTests = <Map<String, dynamic>>[];
    for (final server in _servers) {
      final isHealthy = await _checkHealth(server.baseUrl);
      serverTests.add({
        'name': server.name,
        'url': server.baseUrl,
        'status': isHealthy ? 'OK' : 'FAIL',
        'isActive': server.baseUrl == _activeBaseUrl,
      });
    }
    results['servers'] = serverTests;
    
    return results;
  }
}

/// Configuración de un servidor
class ServerConfig {
  final String name;
  final String baseUrl;
  final int priority;
  final bool isSecure;
  final bool isEmulatorOnly;
  final bool isWSAOnly;
  
  const ServerConfig({
    required this.name,
    required this.baseUrl,
    required this.priority,
    this.isSecure = false,
    this.isEmulatorOnly = false,
    this.isWSAOnly = false,
  });
}
