import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'core/theme/app_theme.dart';
import 'core/providers/auth_provider.dart';
import 'core/cache/cache_service.dart';
import 'core/api/api_client.dart';
import 'features/auth/presentation/pages/login_page.dart';
import 'features/dashboard/presentation/pages/main_shell.dart';
import 'features/sales_history/providers/sales_history_provider.dart';
import 'features/sales_history/presentation/pages/product_history_page.dart';
import 'core/providers/filter_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Hive cache before anything else
  await CacheService.init();

  // Initialize API client with automatic server detection
  // Supports: Production, LAN, Emulator, WSA (Windows Subsystem for Android)
  await ApiClient.initialize();

  // Initialize date formatting for Spanish
  await initializeDateFormatting('es', null);

  // Force landscape orientation for tablet
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  runApp(const GMPSalesAnalyticsApp());
}

class GMPSalesAnalyticsApp extends StatefulWidget {
  const GMPSalesAnalyticsApp({super.key});

  @override
  State<GMPSalesAnalyticsApp> createState() => _GMPSalesAnalyticsAppState();
}

class _GMPSalesAnalyticsAppState extends State<GMPSalesAnalyticsApp> {
  late final AuthProvider _authProvider;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
    _router = _createRouter(_authProvider);
  }

  GoRouter _createRouter(AuthProvider authProvider) {
    return GoRouter(
      refreshListenable: authProvider,
      initialLocation: '/login',
      redirect: (context, state) {
        final isLoggedIn = authProvider.isAuthenticated;
        final isLoggingIn = state.matchedLocation == '/login';

        if (!isLoggedIn && !isLoggingIn) {
          return '/login';
        }
        if (isLoggedIn && isLoggingIn) {
          // CRITICAL: Check if user is Jefe to allow Role Selection Dialog
          // If Jefe, do NOT auto-redirect yet. Logic in LoginPage will handle navigation after dialog.
          if (authProvider.currentUser?.isJefeVentas == true || 
              authProvider.currentUser?.role == 'JEFE_VENTAS' ||
              authProvider.currentUser?.role == 'JEFE') {
             return null; // Stay on /login
          }
          return '/home';
        }
        return null;
      },
      routes: [
        GoRoute(
          path: '/login',
          builder: (context, state) => const LoginPage(),
        ),
        GoRoute(
          path: '/home',
          builder: (context, state) => MainShell(),
        ),
        GoRoute(
          path: '/dashboard', // Alias for /home to support legacy calls
          redirect: (_, __) => '/home', 
        ),
        GoRoute(
          path: '/sales-history',
          builder: (context, state) {
            final clientCode = state.extra as String?;
            return ProductHistoryPage(initialClientCode: clientCode);
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authProvider),
        ChangeNotifierProvider(create: (_) => SalesHistoryProvider()),
        ChangeNotifierProvider(create: (_) => FilterProvider()),
      ],
      child: MaterialApp.router(
        title: 'GMP Sales Analytics',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.darkTheme,
        routerConfig: _router,
      ),
    );
  }
}