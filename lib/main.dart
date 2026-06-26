import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_orchestrator.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/premium_route.dart';
import 'package:gmp_app_mobilidad/features/auth/presentation/pages/login_page.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    Sentry.captureException(details.exception, stackTrace: details.stack);
    debugPrint('[FLUTTER_ERROR] ${details.exceptionAsString()}');
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    Sentry.captureException(error, stackTrace: stack);
    debugPrint('[PLATFORM_ERROR] $error\n$stack');
    return true;
  };

  if (kReleaseMode) {
    ErrorWidget.builder = (FlutterErrorDetails details) {
      return Material(
        color: const Color(0xFF1E1F25),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.warning_amber_rounded,
                  size: 48,
                  color: Colors.orange.shade300,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Se ha producido un error',
                  style: TextStyle(color: Colors.white, fontSize: 16),
                ),
                const SizedBox(height: 8),
                Text(
                  'Error: ${details.exceptionAsString()}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Vuelve atrás o reinicia la app',
                  style: TextStyle(color: Colors.white70, fontSize: 13),
                ),
              ],
            ),
          ),
        ),
      );
    };
  }

  try {
    await CacheService.init();
    debugPrint('[MAIN] ✅ Cache initialized');
    await ApiClient.initialize();
    // Start monitoring WiFi ↔ mobile data changes for adaptive timeouts
    ApiClient.startConnectivityMonitoring();
    // Initialize offline infrastructure
    await ConnectivityService.instance.initialize();
    await SyncQueueService.instance.initialize();
    await NotificationOrchestrator.instance.initialize();
    debugPrint(
      '[MAIN] ✅ API initialized: ${ApiClient.dio.options.baseUrl}',
    );
    debugPrint('[MAIN] ✅ Offline infrastructure initialized');
  } catch (e, stack) {
    debugPrint('[MAIN] ❌ Initialization error: $e');
    debugPrint('[MAIN] Stack: $stack');
    await Sentry.captureException(e, stackTrace: stack);
  }

  await initializeDateFormatting('es');

  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  const sentryDsn = String.fromEnvironment('SENTRY_DSN');
  if (sentryDsn.isNotEmpty) {
    await SentryFlutter.init(
      (options) {
        options.dsn = sentryDsn;
        options.environment = const String.fromEnvironment(
          'SENTRY_ENVIRONMENT',
          defaultValue: 'production',
        );
        options.tracesSampleRate = 0.2;
        options.debug = kDebugMode;
      },
    );
  }

  runZonedGuarded(
    () {
      const app = ProviderScope(child: GMPSalesAnalyticsApp());
      runApp(sentryDsn.isEmpty ? app : SentryWidget(child: app));
    },
    (error, stackTrace) async {
      await Sentry.captureException(error, stackTrace: stackTrace);
      debugPrint('[ZONE_ERROR] $error\n$stackTrace');
    },
  );
}

class GMPSalesAnalyticsApp extends ConsumerStatefulWidget {
  const GMPSalesAnalyticsApp({super.key});

  @override
  ConsumerState<GMPSalesAnalyticsApp> createState() =>
      _GMPSalesAnalyticsAppState();
}

class _GMPSalesAnalyticsAppState extends ConsumerState<GMPSalesAnalyticsApp>
    with WidgetsBindingObserver {
  static const premiumRoutes = <String>[];
  late final GoRouter _router;
  final ValueNotifier<int> _authChangeSignal = ValueNotifier<int>(0);
  StreamSubscription<ConnectivityStatus>? _connectivitySubscription;
  bool _autoSyncInProgress = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _router = _createRouter();
    // Auto-sync pending operations when connectivity is restored.
    _connectivitySubscription =
        ConnectivityService.instance.stream.listen((status) {
      if (status == ConnectivityStatus.online) {
        _runAutoSync();
        unawaited(
          NotificationOrchestrator.instance.refreshAll(
            reason: 'connectivity_online',
          ),
        );
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connectivitySubscription?.cancel();
    _router.dispose();
    _authChangeSignal.dispose();
    super.dispose();
  }

  /// Handle app lifecycle changes to prevent session loss on app resume
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);

    if (state == AppLifecycleState.resumed) {
      unawaited(_handleAppResumed());
    }
  }

  Future<void> _handleAppResumed() async {
    final isSessionValid = await _validateSessionOnResume();
    if (isSessionValid) {
      await _runAutoSync();
      await NotificationOrchestrator.instance.refreshAll(
        reason: 'app_resumed',
      );
    }
  }

  Future<void> _runAutoSync() async {
    if (_autoSyncInProgress) return;
    if (ConnectivityService.instance.currentStatus !=
        ConnectivityStatus.online) {
      return;
    }

    _autoSyncInProgress = true;
    try {
      final genericCount = await SyncQueueService.instance.processAll();
      if (genericCount > 0) {
        debugPrint('[AutoSync] $genericCount generic operations synced');
        OfflineSyncNotifier.genericSyncSucceeded(genericCount);
      }

      await PedidosOfflineService.init();
      final result = await PedidosOfflineService.syncPendingOrdersWithResult();
      final synced = result['synced'] as int? ?? 0;
      final failed = result['failed'] as int? ?? 0;
      if (synced > 0) {
        debugPrint('[AutoSync] $synced offline orders synced');
        OfflineSyncNotifier.orderSyncSucceeded(synced);
      }
      if (failed > 0) {
        debugPrint('[AutoSync] $failed offline orders preserved as failed');
        OfflineSyncNotifier.orderSyncFailed(failed);
      }
      await NotificationOrchestrator.instance.refreshOrderReminders(
        reason: 'auto_sync_complete',
      );
    } catch (e, stack) {
      debugPrint('[AutoSync] Error syncing pending operations: $e');
      await Sentry.captureException(e, stackTrace: stack);
    } finally {
      _autoSyncInProgress = false;
    }
  }

  /// Validate session when app resumes to prevent unexpected logouts
  Future<bool> _validateSessionOnResume() async {
    try {
      final authState = ref.read(authProvider);

      if (!(authState.value?.isAuthenticated ?? false)) return false;

      final isStillValid =
          await ref.read(authProvider.notifier).ensureSessionIsStillValid();
      if (!isStillValid) return false;

      await ApiClient.refreshAccessToken();
      debugPrint('[AppLifecycle] Session validated successfully on resume');
      return true;
    } catch (e) {
      debugPrint('[AppLifecycle] Session validation error: $e');
      return false;
    }
  }

  GoRouter _createRouter() {
    return GoRouter(
      initialLocation: '/dashboard',
      routes: [
        GoRoute(
          path: '/login',
          name: 'login',
          pageBuilder: (context, state) => buildPremiumTransitionPage(
            context: context,
            state: state,
            child: const LoginPage(),
          ),
        ),
        GoRoute(
          path: '/dashboard',
          name: 'dashboard',
          pageBuilder: (context, state) => buildPremiumTransitionPage(
            context: context,
            state: state,
            child: const MainShell(),
          ),
        ),
      ],
      redirect: (context, state) {
        final auth = ref.read(authProvider);
        final isLoggedIn = auth.value?.isAuthenticated ?? false;
        final isLoggingIn = state.matchedLocation == '/login';
        final isInitialized = auth.value?.isInitialized ?? false;

        if (!isInitialized) return null;
        if (!isLoggedIn && !isLoggingIn) return '/login';
        if (isLoggedIn && isLoggingIn) return '/dashboard';
        return null;
      },
      refreshListenable: _authChangeSignal,
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (previous, next) {
      _authChangeSignal.value++;
      final authState = next.value;
      unawaited(
        NotificationOrchestrator.instance.syncForUser(
          user: authState?.user,
          vendedorCodes: authState?.vendedorCodes ?? const <String>[],
          reason: 'auth_provider',
        ),
      );
      if (authState?.isAuthenticated ?? false) {
        _runAutoSync();
      }
    });

    return MaterialApp.router(
      title: 'GMP App Movilidad',
      scaffoldMessengerKey: OfflineSyncNotifier.scaffoldMessengerKey,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.dark,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('es', 'ES'),
        Locale('en', 'US'),
      ],
      locale: const Locale('es', 'ES'),
      routerConfig: _router,
    );
  }
}
