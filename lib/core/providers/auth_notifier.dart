/// Auth Notifier - Riverpod AsyncNotifier v4.0.0
///
/// Replaces AuthProvider (ChangeNotifier) with compile-safe AsyncNotifier.
/// Features:
/// - Auto-login on app start
/// - Login/logout with secure storage
/// - Role switching
/// - 401 global logout callback
/// - Mandatory update check
///
/// @agent Flutter Riverpod - AsyncNotifier + code generation ready
/// @agent Security - Secure token storage, no plaintext credentials
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/services/auth_session_persistence.dart';
import 'package:gmp_app_mobilidad/core/services/cache_prewarmer.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:gmp_app_mobilidad/core/services/session_scope.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non-sensitive preference used to restore the authorized UI mode.
const String authActiveModePreferenceKey = 'auth_active_mode';

final authSessionPersistenceProvider = Provider<AuthSessionPersistence>(
  (ref) => AuthSessionPersistence.secure(),
);

/// Returns an allowed UI mode without changing the user's authorization role.
String authorizedActiveMode(UserModel user, Object? value) {
  final requested = value?.toString().trim().toUpperCase() ?? '';
  if (requested == 'ALMACEN' &&
      user.isJefeVentas &&
      user.userRole == UserRole.jefe) {
    return 'ALMACEN';
  }
  if (requested == 'REPARTIDOR' && user.isRepartidor) {
    return 'REPARTIDOR';
  }
  return 'COMERCIAL';
}

/// Restores a saved mode and revalidates it against the persisted user claims.
String restoreAuthorizedActiveMode(
  SharedPreferences preferences,
  UserModel user,
) {
  return authorizedActiveMode(
    user,
    preferences.getString(authActiveModePreferenceKey),
  );
}

({UserModel user, String activeMode, List<String> vendedorCodes})
    requireCanonicalAuthProjection(
  Map<String, dynamic> response, {
  UserModel? currentUser,
}) {
  final rawUser = response['user'];
  if (rawUser is! Map) {
    throw StateError('Respuesta invalida: perfil canonico ausente');
  }
  final userJson = Map<String, dynamic>.from(rawUser);
  const requiredTopLevelFields = {
    'role',
    'activeMode',
    'availableRoles',
    'availableModes',
    'isJefeVentas',
    'isRepartidor',
    'codigoConductor',
    'matricula',
    'vendorCodes',
    'vendedorCodes',
    'tipoVendedor',
    'showCommissions',
    'claimsVersion',
  };
  const requiredUserFields = {
    'id',
    'code',
    'name',
    'company',
    'vendedorCode',
    'role',
    'activeMode',
    'availableRoles',
    'availableModes',
    'isJefeVentas',
    'isRepartidor',
    'codigoConductor',
    'matricula',
    'vendorCodes',
    'vendedorCodes',
    'tipoVendedor',
    'showCommissions',
    'claimsVersion',
  };
  if (!requiredTopLevelFields.every(response.containsKey) ||
      !requiredUserFields.every(userJson.containsKey)) {
    throw StateError('Respuesta invalida: proyeccion canonica incompleta');
  }

  List<String> normalizedStringList(Object? raw, String key) {
    if (raw is! Iterable || raw.any((value) => value is! String)) {
      throw StateError('Respuesta invalida: $key ausente');
    }
    return raw
        .cast<String>()
        .map((value) => value.trim().toUpperCase())
        .where((value) => value.isNotEmpty)
        .toList(growable: false);
  }

  final user = UserModel.fromJson(userJson);
  final role = response['role']?.toString().trim().toUpperCase() ?? '';
  final activeMode =
      response['activeMode']?.toString().trim().toUpperCase() ?? '';
  if (user.id.isEmpty ||
      user.id == 'null' ||
      user.code.isEmpty ||
      user.name.isEmpty ||
      user.company.isEmpty ||
      user.vendedorCode == null ||
      user.vendedorCode!.trim().isEmpty ||
      role.isEmpty ||
      activeMode.isEmpty) {
    throw StateError('Respuesta invalida: identidad o autorizacion incompleta');
  }
  if (currentUser != null &&
      (user.id != currentUser.id || user.code != currentUser.code)) {
    throw StateError('Respuesta invalida: sujeto de autenticacion distinto');
  }
  if (user.role.toUpperCase() != role ||
      !user.availableRoles.contains(role) ||
      !user.availableModes.contains(activeMode)) {
    throw StateError('Respuesta invalida: rol o modo no autorizado');
  }
  List<String> responseList(String key) {
    return normalizedStringList(response[key], key);
  }

  if (!listEquals(responseList('availableRoles'), user.availableRoles) ||
      !listEquals(responseList('availableModes'), user.availableModes) ||
      !listEquals(
        normalizedStringList(userJson['availableRoles'], 'user.availableRoles'),
        user.availableRoles,
      ) ||
      !listEquals(
        normalizedStringList(userJson['availableModes'], 'user.availableModes'),
        user.availableModes,
      )) {
    throw StateError('Respuesta invalida: capacidades incoherentes');
  }
  if (userJson['activeMode']?.toString().trim().toUpperCase() != activeMode ||
      userJson['role']?.toString().trim().toUpperCase() != role) {
    throw StateError('Respuesta invalida: rol o modo de usuario incoherente');
  }
  if (authorizedActiveMode(user, activeMode) != activeMode) {
    throw StateError('Respuesta invalida: modo incoherente con el perfil');
  }

  final vendedorCodes = List<String>.unmodifiable(
    normalizedStringList(response['vendedorCodes'], 'vendedorCodes'),
  );
  if (vendedorCodes.isEmpty ||
      !listEquals(vendedorCodes, user.vendedorCodes) ||
      !listEquals(responseList('vendorCodes'), vendedorCodes) ||
      !listEquals(
        normalizedStringList(userJson['vendedorCodes'], 'user.vendedorCodes'),
        vendedorCodes,
      ) ||
      !listEquals(
        normalizedStringList(userJson['vendorCodes'], 'user.vendorCodes'),
        vendedorCodes,
      )) {
    throw StateError('Respuesta invalida: ambito de vendedores incoherente');
  }

  if (response['isJefeVentas'] is! bool ||
      response['isRepartidor'] is! bool ||
      userJson['isJefeVentas'] is! bool ||
      userJson['isRepartidor'] is! bool ||
      response['showCommissions'] is! bool ||
      userJson['showCommissions'] is! bool) {
    throw StateError('Respuesta invalida: flags de autorizacion invalidos');
  }
  final topIsJefe = response['isJefeVentas'] as bool;
  final topIsRepartidor = response['isRepartidor'] as bool;
  if (topIsJefe != user.isJefeVentas ||
      topIsRepartidor != user.isRepartidor ||
      userJson['isJefeVentas'] != topIsJefe ||
      userJson['isRepartidor'] != topIsRepartidor ||
      (role == 'JEFE_VENTAS' && !topIsJefe) ||
      (role == 'REPARTIDOR' &&
          (!topIsRepartidor ||
              user.codigoConductor == null ||
              user.codigoConductor!.isEmpty)) ||
      (role != 'REPARTIDOR' &&
          (topIsRepartidor || user.codigoConductor != null))) {
    throw StateError('Respuesta invalida: privilegios de perfil incoherentes');
  }
  if (response['codigoConductor'] != user.codigoConductor ||
      response['matricula'] != user.matricula ||
      response['tipoVendedor'] != user.tipoVendedor ||
      response['showCommissions'] != user.showCommissions) {
    throw StateError('Respuesta invalida: atributos de perfil incoherentes');
  }
  final topClaimsVersion = response['claimsVersion'];
  if (topClaimsVersion is! int ||
      topClaimsVersion <= 0 ||
      userJson['claimsVersion'] != topClaimsVersion ||
      user.claimsVersion != topClaimsVersion) {
    throw StateError('Respuesta invalida: version de claims incoherente');
  }

  return (
    user: user,
    activeMode: activeMode,
    vendedorCodes: vendedorCodes,
  );
}

/// Projects a switch response while replacing every authorization field.
({UserModel user, String activeMode, List<String> vendedorCodes})
    projectAuthorizedModeSwitch({
  required UserModel currentUser,
  required String requestedMode,
  required Map<String, dynamic> response,
}) {
  final projection = requireCanonicalAuthProjection(
    response,
    currentUser: currentUser,
  );
  final normalizedRequest = requestedMode.trim().toUpperCase();
  final responseRole = response['role']?.toString().trim().toUpperCase();
  if (responseRole == null || responseRole.isEmpty) {
    throw StateError('Respuesta inválida: rol ausente');
  }
  final responseMode = response['activeMode']?.toString().trim().toUpperCase();
  if (responseMode == null || responseMode.isEmpty) {
    throw StateError('Respuesta inválida: modo ausente');
  }

  final (expectedRole, expectedMode) = switch (normalizedRequest) {
    'ALMACEN' => ('JEFE_VENTAS', 'ALMACEN'),
    'JEFE_VENTAS' => ('JEFE_VENTAS', 'COMERCIAL'),
    'COMERCIAL' => ('COMERCIAL', 'COMERCIAL'),
    'REPARTIDOR' => ('REPARTIDOR', 'REPARTIDOR'),
    _ => throw StateError('Modo solicitado no válido'),
  };
  if (responseRole != expectedRole || responseMode != expectedMode) {
    throw StateError('Respuesta de cambio de modo incoherente');
  }

  final updatedUser = projection.user;
  final activeMode = authorizedActiveMode(updatedUser, responseMode);
  if (activeMode != expectedMode) {
    throw StateError('Modo solicitado no autorizado');
  }
  return (
    user: updatedUser,
    activeMode: activeMode,
    vendedorCodes: projection.vendedorCodes,
  );
}

/// Requires the complete session rotation returned by a role/mode switch.
({String accessToken, String refreshToken}) requireModeSwitchSession(
  Map<String, dynamic> response,
) {
  final accessToken = response['token'];
  final refreshToken = response['refreshToken'];
  if (accessToken is! String ||
      accessToken.trim().isEmpty ||
      refreshToken is! String ||
      refreshToken.trim().isEmpty) {
    throw StateError('Respuesta inválida: rotación de sesión ausente');
  }
  return (
    accessToken: accessToken,
    refreshToken: refreshToken,
  );
}

({String accessToken, String refreshToken, DateTime expiresAt})
    requireCanonicalSessionRotation(
  Map<String, dynamic> response, {
  required String accessTokenKey,
  DateTime? now,
}) {
  final accessToken = response[accessTokenKey];
  final refreshToken = response['refreshToken'];
  final rawRefreshExpiresIn = response['refreshExpiresIn'];
  final refreshExpiresIn = rawRefreshExpiresIn is num
      ? rawRefreshExpiresIn.toInt()
      : int.tryParse(rawRefreshExpiresIn?.toString() ?? '');
  if (accessToken is! String ||
      accessToken.trim().isEmpty ||
      refreshToken is! String ||
      refreshToken.trim().isEmpty ||
      refreshExpiresIn == null ||
      refreshExpiresIn <= 0 ||
      refreshExpiresIn > const Duration(days: 30).inSeconds) {
    throw StateError('Respuesta invalida: rotacion de sesion incompleta');
  }
  return (
    accessToken: accessToken,
    refreshToken: refreshToken,
    expiresAt: (now ?? DateTime.now()).add(Duration(seconds: refreshExpiresIn)),
  );
}

// ============================================================
// STATE
// ============================================================

class AuthState {
  const AuthState({
    this.user,
    this.vendedorCodes = const [],
    this.activeMode = 'COMERCIAL',
    this.isLoading = false,
    this.error,
    this.isInitialized = false,
    this.updateAvailable = false,
    this.isMandatoryUpdate = false,
    this.updateMessage = '',
  });
  final UserModel? user;
  final List<String> vendedorCodes;
  final String activeMode;
  final bool isLoading;
  final String? error;
  final bool isInitialized;
  final bool updateAvailable;
  final bool isMandatoryUpdate;
  final String updateMessage;

  bool get isAuthenticated => user != null;
  bool get isDirector => user?.isDirector ?? false;
  String get playStoreUrl =>
      'https://play.google.com/store/apps/details?id=com.jlp.gmp_mobilidad';

  AuthState copyWith({
    UserModel? user,
    List<String>? vendedorCodes,
    String? activeMode,
    bool? isLoading,
    String? error,
    bool? isInitialized,
    bool? updateAvailable,
    bool? isMandatoryUpdate,
    String? updateMessage,
  }) {
    return AuthState(
      user: user ?? this.user,
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
      activeMode: activeMode ?? this.activeMode,
      isLoading: isLoading ?? this.isLoading,
      error: error, // null = keep, empty string = clear
      isInitialized: isInitialized ?? this.isInitialized,
      updateAvailable: updateAvailable ?? this.updateAvailable,
      isMandatoryUpdate: isMandatoryUpdate ?? this.isMandatoryUpdate,
      updateMessage: updateMessage ?? this.updateMessage,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthState &&
          runtimeType == other.runtimeType &&
          user == other.user &&
          vendedorCodes == other.vendedorCodes &&
          activeMode == other.activeMode &&
          isLoading == other.isLoading &&
          error == other.error &&
          isInitialized == other.isInitialized &&
          updateAvailable == other.updateAvailable &&
          isMandatoryUpdate == other.isMandatoryUpdate &&
          updateMessage == other.updateMessage;

  @override
  int get hashCode => Object.hash(
        user,
        vendedorCodes,
        activeMode,
        isLoading,
        error,
        isInitialized,
        updateAvailable,
        isMandatoryUpdate,
        updateMessage,
      );
}

/// Whether the state may render the warehouse UI for its existing manager role.
bool isWarehouseUiMode(AuthState? authState) {
  final user = authState?.user;
  return user != null &&
      authState?.activeMode == 'ALMACEN' &&
      authorizedActiveMode(user, authState?.activeMode) == 'ALMACEN';
}

// ============================================================
// NOTIFIER
// ============================================================

// CRITICAL: Do NOT use autoDispose for auth provider.
// When user presses back button and returns, autoDispose would destroy
// the provider and force re-initialization, causing session loss and
// triggering rate limiting from repeated login attempts.
class AuthNotifier extends AsyncNotifier<AuthState> {
  static const Duration _localSessionDuration = Duration(days: 7);
  static const Duration _accessTokenDuration = Duration(hours: 1);
  static const Duration _resumeRefreshThreshold = Duration(minutes: 5);
  static const String _sessionExpiresAtKey = 'session_expires_at';

  Timer? _sessionExpiryTimer;
  Future<void>? _logoutInFlight;

  @override
  Future<AuthState> build() async {
    ref.onDispose(() {
      _sessionExpiryTimer?.cancel();
    });

    // Bind global 401 callback
    ApiClient.onUnauthorized = () {
      debugPrint('[AuthNotifier] 401 detected — logging out');
      unawaited(logout(sessionExpired: true));
    };
    ApiClient.onTokenRefreshed = _applyRefreshedCanonicalSession;
    ApiClient.onAuthSessionDiverged = () => _forceReloginRequired();

    final visualQaRole = _visualQaRoleOverride();
    if (visualQaRole.isNotEmpty) {
      return _buildVisualQaState(visualQaRole);
    }

    // Try auto-login
    return _tryAutoLogin();
  }

  @visibleForTesting
  @protected
  void bindAuthClientCallbacks() {
    ApiClient.onUnauthorized = () {
      unawaited(logout(sessionExpired: true));
    };
    ApiClient.onTokenRefreshed = _applyRefreshedCanonicalSession;
    ApiClient.onAuthSessionDiverged = () => _forceReloginRequired();
  }

  String _visualQaRoleOverride() {
    if (!kDebugMode) return '';
    const definedRole = String.fromEnvironment('GMP_VISUAL_QA_ROLE');
    final role = definedRole.isNotEmpty
        ? definedRole
        : Uri.base.queryParameters['gmpVisualQaRole'] ?? '';
    return role.trim().toLowerCase();
  }

  AuthState _buildVisualQaState(String role) {
    final isRepartidor = role == 'repartidor';
    final isAlmacen = role == 'almacen' || role == 'almacén';

    final user = UserModel(
      id: 'visual-qa-$role',
      code: isRepartidor
          ? 'R01'
          : isAlmacen
              ? 'ALM01'
              : '12',
      name: isRepartidor
          ? 'Repartidor QA'
          : isAlmacen
              ? 'Almacén QA'
              : 'Comercial QA',
      company: 'GMP',
      role: isRepartidor
          ? 'REPARTIDOR'
          : isAlmacen
              ? 'JEFE'
              : 'COMERCIAL',
      vendedorCode: isRepartidor
          ? 'R01'
          : isAlmacen
              ? null
              : '12',
      codigoConductor: isRepartidor ? 'R01' : null,
      isJefeVentas: isAlmacen,
      availableRoles: isRepartidor
          ? const ['REPARTIDOR']
          : isAlmacen
              ? const ['JEFE_VENTAS']
              : const ['COMERCIAL'],
      availableModes: isRepartidor
          ? const ['REPARTIDOR']
          : isAlmacen
              ? const ['COMERCIAL', 'ALMACEN']
              : const ['COMERCIAL'],
      vendedorCodes: isRepartidor
          ? const ['R01']
          : isAlmacen
              ? const ['12', '14', '80']
              : const ['12'],
      showCommissions: true,
    );
    final codes = isRepartidor
        ? const ['R01']
        : isAlmacen
            ? const ['12', '14', '80']
            : const ['12'];

    _applyCacheScope(user, codes);
    return AuthState(
      user: user,
      vendedorCodes: codes,
      activeMode: isAlmacen
          ? 'ALMACEN'
          : isRepartidor
              ? 'REPARTIDOR'
              : 'COMERCIAL',
      isInitialized: true,
    );
  }

  void _applyCacheScope(UserModel user, List<String> vendedorCodes) {
    SessionScope.apply(user, vendedorCodes);
  }

  Future<void> _clearLocalSessionCache() async {
    try {
      await CacheService.clearAll();
      ApiClient.clearPendingRequests();
      SessionScope.clear();
      CachePreWarmer.reset();
      debugPrint('[AuthNotifier] Local session caches cleared');
    } catch (_) {
      debugPrint('[AuthNotifier] Local cache clear failed');
    }
  }

  Future<DateTime?> _readSessionExpiresAt() async {
    final raw = await SecureStorage.readSecureData(_sessionExpiresAtKey);
    if (raw == null || raw.isEmpty) return null;

    final timestamp = int.tryParse(raw);
    if (timestamp != null) {
      return DateTime.fromMillisecondsSinceEpoch(timestamp);
    }

    return DateTime.tryParse(raw);
  }

  bool _isSessionExpired(DateTime? expiresAt, {DateTime? now}) {
    if (expiresAt == null) return true;
    return !(now ?? DateTime.now()).isBefore(expiresAt);
  }

  void _applySessionDeadline(DateTime expiresAt) {
    _sessionExpiryTimer?.cancel();
    ApiClient.authSessionExpiresAt = expiresAt;

    final remaining = expiresAt.difference(DateTime.now());
    if (remaining <= Duration.zero) {
      unawaited(logout(sessionExpired: true));
      return;
    }

    _sessionExpiryTimer = Timer(remaining, () {
      debugPrint('[AuthNotifier] Session deadline reached - logging out');
      unawaited(logout(sessionExpired: true));
    });
  }

  Future<void> _persistNewSessionDeadline() async {
    final expiresAt = DateTime.now().add(_localSessionDuration);
    await SecureStorage.writeSecureData(
      _sessionExpiresAtKey,
      expiresAt.millisecondsSinceEpoch.toString(),
    );
    _applySessionDeadline(expiresAt);
  }

  Future<void> _clearStoredSession([SharedPreferences? _]) async {
    _sessionExpiryTimer?.cancel();
    ApiClient.clearAuthToken();
    ApiClient.authSessionExpiresAt = null;
    await ref.read(authSessionPersistenceProvider).clear();
    await _clearLocalSessionCache();
  }

  Future<void> _forceReloginRequired() async {
    await _clearStoredSession();
    state = const AsyncValue.data(
      AuthState(
        isInitialized: true,
        error: 'La sesion cambio en el servidor. Inicia sesion de nuevo.',
      ),
    );
  }

  Future<bool> _applyRefreshedCanonicalSession(
    Map<String, dynamic> response,
  ) async {
    try {
      await _commitCanonicalSession(
        response,
        accessTokenKey: 'accessToken',
        currentUser: state.value?.user,
      );
      return true;
    } catch (_) {
      await _forceReloginRequired();
      return false;
    }
  }

  Future<void> _commitCanonicalSession(
    Map<String, dynamic> response, {
    required String accessTokenKey,
    UserModel? currentUser,
  }) async {
    final projection = requireCanonicalAuthProjection(
      response,
      currentUser: currentUser,
    );
    final rotation = requireCanonicalSessionRotation(
      response,
      accessTokenKey: accessTokenKey,
    );
    await ref.read(authSessionPersistenceProvider).commit(
          CanonicalLocalAuthSession(
            accessToken: rotation.accessToken,
            refreshToken: rotation.refreshToken,
            userJson: jsonEncode(projection.user.toJson()),
            vendedorCodes: projection.vendedorCodes,
            activeMode: projection.activeMode,
            expiresAt: rotation.expiresAt,
          ),
        );

    // Publish bearer and UI only after every local write succeeded.
    ApiClient.setAuthToken(rotation.accessToken);
    _applySessionDeadline(rotation.expiresAt);
    await _clearLocalSessionCache();
    _applyCacheScope(projection.user, projection.vendedorCodes);
    final previous = state.value;
    state = AsyncValue.data(
      previous?.copyWith(
            user: projection.user,
            vendedorCodes: projection.vendedorCodes,
            activeMode: projection.activeMode,
            isLoading: false,
            error: '',
          ) ??
          AuthState(
            user: projection.user,
            vendedorCodes: projection.vendedorCodes,
            activeMode: projection.activeMode,
            isInitialized: true,
          ),
    );
  }

  /// Validates the persisted session deadline and clears auth if it expired.
  Future<bool> ensureSessionIsStillValid() async {
    final authState = state.value;
    if (!(authState?.isAuthenticated ?? false)) return false;

    final token = await SecureStorage.readSecureData('user_token');
    final expiresAt = await _readSessionExpiresAt();

    if (token == null ||
        token.isEmpty ||
        expiresAt == null ||
        _isSessionExpired(expiresAt)) {
      debugPrint(
        '[AuthNotifier] Stored session missing or expired - clearing session',
      );
      await logout(sessionExpired: true);
      return false;
    }

    ApiClient.setAuthToken(token);
    _applySessionDeadline(expiresAt);
    return true;
  }

  /// Restores the token after app resume and refreshes it only near expiry.
  ///
  /// Resume can happen while Android/iOS is still reconnecting sockets. Avoiding
  /// an unconditional refresh prevents noisy endpoint failures after returning
  /// from the launcher or recent-apps screen.
  Future<bool> ensureSessionIsReadyForResume() async {
    final isStillValid = await ensureSessionIsStillValid();
    if (!isStillValid) return false;

    final token = await SecureStorage.readSecureData('user_token');
    if (token == null || token.isEmpty) return false;

    if (_isTokenExpiringSoon(token)) {
      final refreshed = await ApiClient.refreshAccessToken();
      if (refreshed) {
        final refreshedToken = await SecureStorage.readSecureData('user_token');
        if (refreshedToken != null && refreshedToken.isNotEmpty) {
          ApiClient.setAuthToken(refreshedToken);
        }
      } else {
        return false;
      }
    }

    return true;
  }

  /// Returns true if the stored token is expired.
  /// The server uses a custom 2-part HMAC format: base64(JSON).hmacHex
  /// The payload contains a 'timestamp' (ms epoch); access tokens are short
  /// lived and renewed by the refresh session.
  DateTime? _tokenIssuedAt(String token) {
    try {
      final dotIndex = token.indexOf('.');
      if (dotIndex < 1) return null;
      var dataB64 = token.substring(0, dotIndex);
      switch (dataB64.length % 4) {
        case 2:
          dataB64 += '==';
        case 3:
          dataB64 += '=';
        default:
      }
      final decoded = utf8.decode(base64.decode(dataB64));
      final data = jsonDecode(decoded) as Map<String, dynamic>;
      final timestamp = data['timestamp'];
      if (timestamp == null) return null;
      final ts = timestamp is int
          ? timestamp
          : int.tryParse(timestamp.toString()) ?? 0;
      if (ts <= 0) return null;
      return DateTime.fromMillisecondsSinceEpoch(ts);
    } catch (_) {
      return null;
    }
  }

  bool _isTokenExpired(String token) {
    final issuedAt = _tokenIssuedAt(token);
    if (issuedAt == null) return true;
    return DateTime.now().difference(issuedAt) >= _accessTokenDuration;
  }

  bool _isTokenExpiringSoon(String token) {
    final issuedAt = _tokenIssuedAt(token);
    if (issuedAt == null) return true;
    final expiresAt = issuedAt.add(_accessTokenDuration);
    return !DateTime.now().add(_resumeRefreshThreshold).isBefore(expiresAt);
  }

  /// Attempt to restore session from storage
  Future<AuthState> _tryAutoLogin() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      var token = await SecureStorage.readSecureData('user_token');
      var userDataStr = await SecureStorage.readSecureData('user_data');
      var codes = prefs.getStringList('vendedor_codes');
      final expiresAt = await _readSessionExpiresAt();

      if (token != null || userDataStr != null || codes != null) {
        if (token == null ||
            token.isEmpty ||
            userDataStr == null ||
            expiresAt == null ||
            _isSessionExpired(expiresAt)) {
          debugPrint(
            '[AuthNotifier] Stored session incomplete or expired - clearing session',
          );
          await _clearStoredSession(prefs);
          return const AuthState(isInitialized: true);
        }
      }

      if (token != null && userDataStr != null) {
        _applySessionDeadline(expiresAt!);

        // Check token expiry BEFORE restoring session to avoid a burst of 401s
        if (_isTokenExpired(token)) {
          ApiClient.setAuthToken(token);
          final refreshed = await ApiClient.refreshAccessToken();
          token = await SecureStorage.readSecureData('user_token');
          if (refreshed && token != null && token.isNotEmpty) {
            userDataStr = await SecureStorage.readSecureData('user_data');
            codes = prefs.getStringList('vendedor_codes');
            debugPrint('[AuthNotifier] Stored token refreshed');
          } else if (ApiClient.lastTokenRefreshFailedDueToConnectivity &&
              !_isSessionExpired(expiresAt)) {
            debugPrint(
              '[AuthNotifier] Stored token expired but refresh is offline - restoring local session',
            );
          } else {
            debugPrint(
                '[AuthNotifier] Stored token expired — clearing session');
            await _clearStoredSession(prefs);
            return const AuthState(isInitialized: true);
          }
        }
        // Validate token with server before restoring session.
        // The server uses ephemeral JWT secrets — a server restart invalidates
        // all stored tokens even if they haven't expired by time.
        // If the server is unreachable (offline), we proceed optimistically.
        final currentToken = token;
        if (currentToken == null || currentToken.isEmpty) {
          await _clearStoredSession(prefs);
          return const AuthState(isInitialized: true);
        }
        ApiClient.setAuthToken(currentToken);
        ApiClient.startLogin(); // suppress onUnauthorized during validation
        try {
          await ApiClient.get(ApiConfig.validate);
        } on ApiException catch (e) {
          if (e.statusCode == 401 || e.statusCode == 403) {
            debugPrint(
              '[AuthNotifier] Server rejected stored token — clearing session',
            );
            await _clearStoredSession(prefs);
            return const AuthState(isInitialized: true);
          }
        } catch (_) {
          // Network error — proceed with stored session (offline-tolerant)
          debugPrint(
              '[AuthNotifier] Could not reach server, proceeding offline');
        } finally {
          ApiClient.endLogin();
        }
        final restoredUserData = userDataStr;
        if (restoredUserData == null) {
          await _clearStoredSession(prefs);
          return const AuthState(isInitialized: true);
        }
        final user = UserModel.fromJson(
          jsonDecode(restoredUserData) as Map<String, dynamic>,
        );
        final vendedorCodes = codes ?? [];
        final activeMode = restoreAuthorizedActiveMode(prefs, user);
        _applyCacheScope(user, vendedorCodes);

        // Pre-warm cache in background
        unawaited(
          CachePreWarmer.preWarmCache(
            vendedorCodes: vendedorCodes,
            isJefeVentas: user.isJefeVentas,
          ),
        );

        // Check for updates in background
        unawaited(_checkForUpdates());

        return AuthState(
          user: user,
          vendedorCodes: vendedorCodes,
          activeMode: activeMode,
          isInitialized: true,
        );
      }
    } catch (_) {
      debugPrint('[AuthNotifier] Auto-login failed');
      await _clearStoredSession();
    }

    return const AuthState(isInitialized: true);
  }

  /// Login with credentials
  Future<bool> login(String username, String password) => _loginCanonical(
        username: username,
        password: password,
        allowRoleSelection: true,
      );

  /// Login for multi-role users
  Future<bool> loginWithRole(
    String username,
    String password,
    String role,
  ) =>
      _loginCanonical(
        username: username,
        password: password,
        selectedRole: role,
        allowRoleSelection: false,
      );

  Future<bool> _loginCanonical({
    required String username,
    required String password,
    required bool allowRoleSelection,
    String? selectedRole,
  }) async {
    if (username.trim().isEmpty || password.isEmpty) {
      state = const AsyncValue.data(
        AuthState(
          isInitialized: true,
          error: 'Usuario y contraseña requeridos.',
        ),
      );
      return false;
    }

    ApiClient.startLogin();
    state = const AsyncValue.loading();
    try {
      // Remove stale fragments before attempting to publish a new session.
      await _clearStoredSession();
      await ApiClient.ensureDioReady();
      final payload = <String, dynamic>{
        'username': username,
        'password': password,
        if (selectedRole != null) 'role': selectedRole,
      };
      final response = await ApiClient.post(ApiConfig.login, payload);

      if (response['requiresRoleSelection'] == true && allowRoleSelection) {
        final roles = response['availableRoles'];
        if (roles is! Iterable) {
          await _setFailedLogin('Respuesta de autenticación inválida.');
          return false;
        }
        const allowedRoles = {
          'ADMIN',
          'DIRECTOR',
          'JEFE_VENTAS',
          'COMERCIAL',
          'REPARTIDOR',
        };
        final safeRoles = roles
            .whereType<String>()
            .map((role) => role.trim().toUpperCase())
            .where(allowedRoles.contains)
            .toSet()
            .toList(growable: false);
        if (safeRoles.isEmpty) {
          await _setFailedLogin('Respuesta de autenticación inválida.');
          return false;
        }
        state = AsyncValue.data(
          AuthState(
            isInitialized: true,
            error: 'ROLE_SELECTION',
            updateMessage: jsonEncode(safeRoles),
          ),
        );
        return false;
      }

      await _commitCanonicalSession(
        response,
        accessTokenKey: 'token',
      );
      final authenticated = state.value;
      if (authenticated?.isAuthenticated != true) {
        await _setFailedLogin('Respuesta de autenticación inválida.');
        return false;
      }
      preWarmAuthenticatedSession(authenticated!);
      return true;
    } catch (error) {
      await _setFailedLogin(_safeLoginError(error));
      return false;
    } finally {
      ApiClient.endLogin();
    }
  }

  @protected
  void preWarmAuthenticatedSession(AuthState authenticated) {
    unawaited(
      CachePreWarmer.preWarmCache(
        vendedorCodes: authenticated.vendedorCodes,
        isJefeVentas: authenticated.user!.isJefeVentas,
      ),
    );
  }

  Future<void> _setFailedLogin(String message) async {
    await _clearStoredSession();
    state = AsyncValue.data(
      AuthState(isInitialized: true, error: message),
    );
  }

  String _safeLoginError(Object error) {
    if (error is ApiException) {
      if (error.statusCode == 401) return 'Credenciales inválidas.';
      if (error.statusCode == 429) {
        return 'Demasiados intentos. Inténtalo más tarde.';
      }
      if (error.statusCode == 503) {
        return 'Servicio de autenticación no disponible.';
      }
    }
    return 'No se pudo iniciar sesión.';
  }

  /// Logout
  Future<void> logout({bool sessionExpired = false}) {
    final active = _logoutInFlight;
    if (active != null) return active;

    late Future<void> guarded;
    guarded = _logoutOnce(sessionExpired: sessionExpired).whenComplete(() {
      if (identical(_logoutInFlight, guarded)) _logoutInFlight = null;
    });
    _logoutInFlight = guarded;
    return guarded;
  }

  Future<void> _logoutOnce({required bool sessionExpired}) async {
    var remoteLogoutFailed = false;
    try {
      await ApiClient.revokeCurrentSession();
    } catch (_) {
      remoteLogoutFailed = true;
    }

    // Clear auth state immediately
    state = AsyncValue.data(
      AuthState(
        isInitialized: true,
        error: sessionExpired
            ? 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.'
            : null,
      ),
    );

    await _clearStoredSession();

    // Clear filters
    try {
      ref.read(filterProvider.notifier).clear();
    } catch (_) {
      debugPrint('[AuthNotifier] Filter clear failed');
    }

    if (!sessionExpired && remoteLogoutFailed) {
      state = const AsyncValue.data(
        AuthState(
          isInitialized: true,
          error:
              'La sesion local se cerro; no se pudo confirmar el cierre remoto.',
        ),
      );
    }
  }

  /// Switch role (Jefe / Comercial / Repartidor)
  Future<bool> switchRole(String newRole, {String? viewAs}) async {
    final currentState = state.value;
    if (currentState?.user == null) return false;

    if (!await ensureSessionIsStillValid()) return false;

    state = AsyncValue.data(currentState!.copyWith(isLoading: true));

    ApiClient.startLogin();
    var serverAccepted = false;
    try {
      final response = await ApiClient.post(
        '/auth/switch-role',
        {
          'userId': currentState.user!.code,
          'newRole': newRole,
          'viewAs': viewAs,
        },
      );

      if (response == null || response['success'] != true) {
        await _forceReloginRequired();
        return false;
      }
      serverAccepted = true;
      projectAuthorizedModeSwitch(
        currentUser: currentState.user!,
        requestedMode: newRole,
        response: response,
      );
      await _commitCanonicalSession(
        response,
        accessTokenKey: 'token',
        currentUser: currentState.user,
      );
      return true;
    } catch (e) {
      final statusCode = e is ApiException ? e.statusCode : null;
      final definitiveRejection =
          !serverAccepted && const [400, 403, 422].contains(statusCode);
      if (definitiveRejection) {
        state = AsyncValue.data(
          currentState.copyWith(
            isLoading: false,
            error: 'El perfil solicitado no esta autorizado.',
          ),
        );
      } else {
        await _forceReloginRequired();
      }
      return false;
    } finally {
      ApiClient.endLogin();
    }
  }

  /// Check for mandatory updates
  Future<void> _checkForUpdates() async {
    try {
      final response = await ApiClient.get('/health/version-check');
      if (response == null) return;

      final currentState = state.value;
      if (currentState == null) return;

      final data = response as Map<String, dynamic>;
      state = AsyncValue.data(
        currentState.copyWith(
          updateAvailable: data['updateAvailable'] == true,
          isMandatoryUpdate: data['isMandatoryUpdate'] == true,
          updateMessage: (data['message'] as String?) ?? '',
        ),
      );
    } catch (_) {
      debugPrint('[AuthNotifier] Update check failed');
    }
  }

  /// Clear error
  void clearError() {
    final currentState = state.value;
    if (currentState != null) {
      state = AsyncValue.data(currentState.copyWith());
    }
  }
}

// ============================================================
// PROVIDER
// ==========================================================

final authProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

// ============================================================
// SELECTORS (derived state, recompute only when dependency changes)
// ============================================================

final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isAuthenticated ?? false;
});

final currentUserProvider = Provider<UserModel?>((ref) {
  return ref.watch(authProvider).value?.user;
});

final vendedorCodesProvider = Provider<List<String>>((ref) {
  return ref.watch(authProvider).value?.vendedorCodes ?? [];
});

final isJefeVentasProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isDirector ?? false;
});

final isInitializedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isInitialized ?? false;
});

final authErrorProvider = Provider<String?>((ref) {
  return ref.watch(authProvider).value?.error;
});

final updateCheckProvider =
    Provider<({bool available, bool mandatory, String message})>((ref) {
  final state = ref.watch(authProvider).value;
  return (
    available: state?.updateAvailable ?? false,
    mandatory: state?.isMandatoryUpdate ?? false,
    message: state?.updateMessage ?? '',
  );
});
