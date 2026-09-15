import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:gmp_app_mobilidad/core/services/auth_session_persistence.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:gmp_app_mobilidad/core/services/session_scope.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_service.dart';
import 'package:gmp_app_mobilidad/features/commissions/data/commissions_service.dart';
import 'package:gmp_app_mobilidad/features/facturas/data/facturas_service.dart';
import 'package:gmp_app_mobilidad/features/objectives/data/objectives_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

class NotificationSessionStore {
  const NotificationSessionStore._();

  static NotificationUserProfile fromUser(
    UserModel user,
    List<String> vendedorCodes,
  ) {
    final conductorCodes = <String>[
      if ((user.codigoConductor ?? '').trim().isNotEmpty)
        user.codigoConductor!.trim(),
    ];
    return NotificationUserProfile(
      userCode: user.code,
      role: user.role,
      isJefeVentas: user.isJefeVentas,
      vendorCodes: vendedorCodes,
      userName: user.name,
      conductorCodes: conductorCodes,
      showCommissions: user.showCommissions,
    );
  }

  static Future<void> rememberUserSession(
    UserModel user,
    List<String> vendedorCodes,
  ) async {
    await NotificationPreferencesService.instance.rememberSession(
      fromUser(user, vendedorCodes),
    );
  }

  static Future<NotificationUserProfile?> loadStoredProfile({
    bool allowLastKnownProfile = false,
  }) async {
    final token = await SecureStorage.readSecureData('user_token');
    final userDataStr = await SecureStorage.readSecureData('user_data');
    if (token == null ||
        token.isEmpty ||
        userDataStr == null ||
        userDataStr.isEmpty) {
      return allowLastKnownProfile ? loadLastKnownProfile() : null;
    }

    try {
      final user = UserModel.fromJson(
        jsonDecode(userDataStr) as Map<String, dynamic>,
      );
      final vendedorCodes = await AuthSessionPersistence.readVendedorCodes();
      ApiClient.setAuthToken(token);
      SessionScope.apply(user, vendedorCodes);
      final profile = fromUser(user, vendedorCodes);
      await NotificationPreferencesService.instance.rememberSession(profile);
      return profile;
    } catch (e) {
      debugPrint('[Notifications] Stored profile unavailable: $e');
      return allowLastKnownProfile ? loadLastKnownProfile() : null;
    }
  }

  static Future<NotificationUserProfile?> loadLastKnownProfile() async {
    final sessions =
        await NotificationPreferencesService.instance.loadSessionHistory();
    if (sessions.isEmpty) return null;
    final profile = sessions.first.profile;
    SessionScope.applyRaw(
      userCode: profile.userCode,
      role: profile.role,
      isJefeVentas: profile.isJefeVentas,
      vendedorCodes: profile.vendorCodes,
    );
    return profile;
  }
}

class NotificationDataRepository {
  const NotificationDataRepository();

  Future<NotificationSnapshot> loadSnapshot({
    required NotificationUserProfile? profile,
    DateTime? now,
  }) async {
    final effectiveNow = now ?? DateTime.now();
    final orders = await _loadOrders(
      profile: profile,
      now: effectiveNow,
      includeServerCounts: false,
    );

    if (profile == null) {
      return NotificationSnapshot(scopeKey: 'anon', orders: orders);
    }

    final aggregated = await _loadAggregatedSnapshot(
      profile: profile,
      now: effectiveNow,
      localOrders: orders,
    );
    if (aggregated != null) return aggregated;

    final canCommercial = profile.canReceiveCommercialAlerts;
    final canDelivery = profile.canReceiveDeliveryAlerts;

    final commercialResults = canCommercial
        ? await Future.wait<Object?>([
            _loadBolsa(profile, effectiveNow),
            _loadKpiBundle(profile),
            _loadRutero(profile, effectiveNow),
            _safeServerOrderCount(profile, 'BORRADOR'),
            _safeServerOrderCount(profile, 'PENDIENTE'),
          ])
        : const <Object?>[];

    if (canCommercial) {
      unawaited(_deferSecondarySnapshot(profile, effectiveNow));
    }

    final deliveries =
        canDelivery ? await _loadDeliveries(profile, effectiveNow) : null;

    final kpi = canCommercial
        ? commercialResults[1]! as _KpiNotificationBundle
        : const _KpiNotificationBundle();
    final serverDraft = canCommercial ? commercialResults[3]! as int : 0;
    final serverPending = canCommercial ? commercialResults[4]! as int : 0;

    return NotificationSnapshot(
      scopeKey: profile.scopeKey,
      profile: profile,
      orders: OrderReminderSnapshot(
        localDraftCount: orders.localDraftCount,
        localPendingCount: orders.localPendingCount,
        localFailedCount: orders.localFailedCount,
        serverDraftCount: serverDraft,
        serverPendingCount: serverPending,
        oldestAt: orders.oldestAt,
        clientNames: orders.clientNames,
      ),
      rutero: canCommercial
          ? commercialResults[2] as RuteroNotificationSnapshot?
          : null,
      glacius: kpi.glacius,
      clients: kpi.clients,
      bolsa: canCommercial
          ? commercialResults[0] as BolsaNotificationSnapshot?
          : null,
      deliveries: deliveries,
    );
  }

  Future<void> _deferSecondarySnapshot(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    try {
      await Future<void>.delayed(const Duration(seconds: 30));
      await Future.wait<Object?>([
        _loadObjectives(profile, now),
        _loadRutero(profile, now.add(const Duration(days: 1))),
        _loadInvoices(profile, now),
        _loadCommissions(profile, now),
        _loadSalesDay(profile, now),
      ]);
    } catch (e) {
      debugPrint('[Notifications] Deferred snapshot failed: $e');
    }
  }

  Future<NotificationSnapshot?> _loadAggregatedSnapshot({
    required NotificationUserProfile profile,
    required DateTime now,
    required OrderReminderSnapshot localOrders,
  }) async {
    if (!profile.canReceiveCommercialAlerts) return null;
    try {
      final response = await ApiClient.get(
        '/notifications/snapshot',
        cacheKey: 'notifications:snapshot:${profile.scopeKey}',
        cacheTTL: const Duration(seconds: 60),
      );
      if (response['success'] != true) return null;
      final deliveries = profile.canReceiveDeliveryAlerts
          ? await _loadDeliveries(profile, now)
          : null;
      return NotificationBackendSnapshotMapper.map(
        body: response,
        profile: profile,
        localOrders: localOrders,
        now: now,
        deliveries: deliveries,
      );
    } catch (e) {
      debugPrint('[Notifications] Aggregated snapshot unavailable: $e');
      return null;
    }
  }

  Future<OrderReminderSnapshot> _loadOrders({
    required NotificationUserProfile? profile,
    required DateTime now,
    bool includeServerCounts = true,
  }) async {
    try {
      await PedidosOfflineService.init();
    } catch (e) {
      debugPrint('[Notifications] Pedidos offline init failed: $e');
    }

    final drafts = PedidosOfflineService.getDrafts();
    final pending = PedidosOfflineService.getPendingSyncs();
    final failed = PedidosOfflineService.getFailedSyncs();
    final clientNames = <String>[
      ...drafts.map((item) => item['clientName']?.toString() ?? ''),
      ...pending.map((item) => item['clientName']?.toString() ?? ''),
      ...failed.map((item) => item['clientName']?.toString() ?? ''),
    ].where((name) => name.trim().isNotEmpty).take(4).toList();

    var serverDraftCount = 0;
    var serverPendingCount = 0;
    if (includeServerCounts &&
        profile != null &&
        profile.canReceiveCommercialAlerts) {
      final serverCounts = await Future.wait<int>([
        _safeServerOrderCount(profile, 'BORRADOR'),
        _safeServerOrderCount(profile, 'PENDIENTE'),
      ]);
      serverDraftCount = serverCounts[0];
      serverPendingCount = serverCounts[1];
    }

    return OrderReminderSnapshot(
      localDraftCount: drafts.length,
      localPendingCount: pending.length,
      localFailedCount: failed.length,
      serverDraftCount: serverDraftCount,
      serverPendingCount: serverPendingCount,
      oldestAt: _oldestOrderDate(drafts, pending, failed),
      clientNames: clientNames,
    );
  }

  Future<int> _safeServerOrderCount(
    NotificationUserProfile profile,
    String status,
  ) async {
    try {
      final orders = await PedidosService.getOrders(
        vendedorCodes: profile.vendorCodesCsv,
        status: status,
        limit: 10,
        page: 1,
      );
      return orders.length;
    } catch (e) {
      debugPrint('[Notifications] Server order count failed ($status): $e');
      return 0;
    }
  }

  DateTime? _oldestOrderDate(
    List<Map<String, dynamic>> drafts,
    List<dynamic> pending,
    List<dynamic> failed,
  ) {
    final dates = <DateTime>[];
    for (final item in drafts) {
      final parsed = DateTime.tryParse(item['savedAt']?.toString() ?? '');
      if (parsed != null) dates.add(parsed);
    }
    for (final item in [...pending, ...failed]) {
      if (item is! Map) continue;
      final parsed = DateTime.tryParse(
        item['queuedAt']?.toString() ??
            item['failedAt']?.toString() ??
            item['lastSyncStartedAt']?.toString() ??
            '',
      );
      if (parsed != null) dates.add(parsed);
    }
    if (dates.isEmpty) return null;
    dates.sort();
    return dates.first;
  }

  Future<ObjectivesNotificationSnapshot?> _loadObjectives(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    try {
      final response = await ObjectivesService.getEvolution(
        vendedorCodes: profile.vendorCodesCsv,
        years: [now.year],
      );
      final yearlyData = response['yearlyData'] is Map
          ? Map<String, dynamic>.from(response['yearlyData'] as Map)
          : <String, dynamic>{};
      final months = yearlyData[now.year.toString()] as List? ?? const [];
      final rawMonth = months.cast<dynamic>().firstWhere(
            (item) =>
                item is Map && (item['month'] as num?)?.toInt() == now.month,
            orElse: () => null,
          );
      if (rawMonth is! Map) return null;
      final monthData = Map<String, dynamic>.from(rawMonth);
      final sales = _toDouble(monthData['sales']);
      final objective = _toDouble(monthData['objective']);
      final workingDays = _toInt(monthData['workingDays'], fallback: 22);
      var daysPassed = _toInt(monthData['daysPassed']);
      if (daysPassed <= 0) daysPassed = _workingDaysPassed(now);
      final paceObjective = workingDays > 0
          ? objective / workingDays * daysPassed.clamp(0, workingDays)
          : 0.0;
      return ObjectivesNotificationSnapshot(
        year: now.year,
        month: now.month,
        sales: sales,
        objective: objective,
        paceObjective: paceObjective,
        daysPassed: daysPassed,
        workingDays: workingDays,
      );
    } catch (e) {
      debugPrint('[Notifications] Objectives snapshot failed: $e');
      return null;
    }
  }

  Future<RuteroNotificationSnapshot?> _loadRutero(
    NotificationUserProfile profile,
    DateTime date,
  ) async {
    try {
      final dayName = _dayName(date);
      final week = ((date.day + date.weekday - 2) ~/ 7) + 1;
      final response = await ApiClient.get(
        '${ApiConfig.ruteroDay}/$dayName',
        queryParameters: {
          'vendedorCodes': profile.vendorCodesCsv,
          'role': 'comercial',
          'year': date.year,
          'month': date.month,
          'week': week,
        },
        cacheKey: [
          'notifications',
          'rutero_day',
          profile.scopeKey,
          date.year,
          date.month,
          week,
          dayName,
        ].join(':'),
        cacheTTL: const Duration(minutes: 30),
      );
      final clients = (response['clients'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList(growable: false);
      final sortedBySales = List<Map<String, dynamic>>.from(clients)
        ..sort((a, b) {
          return _statusSales(b).compareTo(_statusSales(a));
        });
      final names = clients
          .map((item) => item['name']?.toString() ?? '')
          .where((name) => name.trim().isNotEmpty)
          .take(4)
          .toList(growable: false);
      final priorityNames = sortedBySales
          .map((item) => item['name']?.toString() ?? '')
          .where((name) => name.trim().isNotEmpty)
          .take(3)
          .toList(growable: false);
      var inactive = 0;
      var news = 0;
      var totalSales = 0.0;
      for (final client in clients) {
        final status = client['status'] is Map
            ? Map<String, dynamic>.from(client['status'] as Map)
            : <String, dynamic>{};
        final ytd = _toDouble(
          status['ytdSales'] ?? status['currentMonthSales'],
        );
        final prev =
            _toDouble(status['ytdPrevYear'] ?? status['prevMonthSales']);
        final prevYearTotal = _toDouble(status['prevYearTotal']);
        totalSales += ytd;
        if (ytd < 0.01 && prev < 0.01) inactive++;
        if (ytd > 0.01 && prevYearTotal < 0.01) news++;
      }
      return RuteroNotificationSnapshot(
        date: DateTime(date.year, date.month, date.day),
        dayName: dayName,
        clientCount: clients.length,
        clientNames: names,
        priorityClientNames: priorityNames,
        inactiveClientCount: inactive,
        newClientCount: news,
        totalSales: totalSales,
      );
    } catch (e) {
      debugPrint('[Notifications] Rutero snapshot failed: $e');
      return null;
    }
  }

  Future<_KpiNotificationBundle> _loadKpiBundle(
    NotificationUserProfile profile,
  ) async {
    try {
      final response = await ApiClient.get(
        ApiConfig.kpiDashboard,
        queryParameters: {'vendorCode': profile.vendorCodesCsv},
        cacheKey: 'notifications:kpi_dashboard:${profile.scopeKey}',
        cacheTTL: const Duration(minutes: 30),
      );
      if (response['success'] != true) return const _KpiNotificationBundle();
      final totals = response['totals'] is Map
          ? Map<String, dynamic>.from(response['totals'] as Map)
          : <String, dynamic>{};
      final byType = (response['byType'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList(growable: false);
      final clients = (response['clients'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList(growable: false);

      var reincorporationCount = 0;
      var noPurchaseCount = 0;
      var newClientCount = 0;
      for (final item in byType) {
        final type = item['type']?.toString().toUpperCase() ?? '';
        final label = item['label']?.toString().toUpperCase() ?? '';
        final count = _toInt(item['count']);
        final isReincorporation = type.contains('ALTA') ||
            type.contains('REINCOR') ||
            label.contains('ALTA') ||
            label.contains('REINCOR');
        if (isReincorporation) reincorporationCount += count;
        if (type.contains('SIN_COMPRA') || label.contains('SIN COMPRA')) {
          noPurchaseCount += count;
        }
        if (type.contains('ALTA') || label.contains('CLIENTE NUEVO')) {
          newClientCount += count;
        }
      }

      final clientNames = clients
          .map((item) => item['name']?.toString() ?? '')
          .where((name) => name.trim().isNotEmpty)
          .take(4)
          .toList(growable: false);

      return _KpiNotificationBundle(
        glacius: GlaciusNotificationSnapshot(
          totalAlerts: _toInt(totals['alerts'] ?? totals['totalAlerts']),
          criticalAlerts:
              _toInt(totals['critical'] ?? totals['criticalAlerts']),
          reincorporationAlerts: reincorporationCount,
          clientNames: clientNames,
        ),
        clients: ClientsNotificationSnapshot(
          criticalAlertCount:
              _toInt(totals['critical'] ?? totals['criticalAlerts']),
          warningAlertCount: _toInt(totals['warning'] ?? totals['warnings']),
          noPurchaseCount: noPurchaseCount,
          newClientCount: newClientCount,
          clientNames: clientNames,
        ),
      );
    } catch (e) {
      debugPrint('[Notifications] KPI snapshot failed: $e');
      return const _KpiNotificationBundle();
    }
  }

  Future<InvoicesNotificationSnapshot?> _loadInvoices(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    try {
      final today = _dateKey(now);
      final results = await Future.wait<FacturaSummary?>([
        FacturasService.getSummary(
          vendedorCodes: profile.vendorCodesCsv,
          dateFrom: today,
          dateTo: today,
        ),
        FacturasService.getSummary(
          vendedorCodes: profile.vendorCodesCsv,
          year: now.year,
          month: now.month,
        ),
      ]);
      final todaySummary = results[0];
      final monthSummary = results[1];
      return InvoicesNotificationSnapshot(
        todayDocuments: todaySummary?.totalDocumentos ?? 0,
        todayInvoices: todaySummary?.totalFacturasEmitidas ?? 0,
        todayDeliveryNotes: todaySummary?.totalAlbaranes ?? 0,
        todayAmount: todaySummary?.totalImporte ?? 0,
        monthDocuments: monthSummary?.totalDocumentos ?? 0,
        monthAmount: monthSummary?.totalImporte ?? 0,
      );
    } catch (e) {
      debugPrint('[Notifications] Facturas snapshot failed: $e');
      return null;
    }
  }

  Future<CommissionsNotificationSnapshot?> _loadCommissions(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    if (!profile.showCommissions) return null;
    try {
      final code = profile.isJefeRole ? 'ALL' : _primaryVendorCode(profile);
      if (code.isEmpty) return null;
      final data = await CommissionsService.getSummary(
        vendedorCode: code,
        year: now.year,
      );
      final months = data['months'] as List? ?? const [];
      final rawMonth = months.cast<dynamic>().firstWhere(
            (item) =>
                item is Map && (item['month'] as num?)?.toInt() == now.month,
            orElse: () => null,
          );
      if (rawMonth is! Map) return null;
      final month = Map<String, dynamic>.from(rawMonth);
      final ctx = month['complianceCtx'] is Map
          ? Map<String, dynamic>.from(month['complianceCtx'] as Map)
          : <String, dynamic>{};
      final payments = data['payments'] is Map
          ? Map<String, dynamic>.from(data['payments'] as Map)
          : <String, dynamic>{};
      final monthlyPaid = payments['monthly'] is Map
          ? Map<String, dynamic>.from(payments['monthly'] as Map)
          : <String, dynamic>{};
      return CommissionsNotificationSnapshot(
        month: now.month,
        currentSales: _toDouble(month['actual']),
        monthTarget: _toDouble(month['target']),
        monthCommission: _toDouble(ctx['commission']),
        paidThisMonth: _toDouble(
          monthlyPaid[now.month.toString()],
        ),
      );
    } catch (e) {
      debugPrint('[Notifications] Commissions snapshot failed: $e');
      return null;
    }
  }

  Future<BolsaNotificationSnapshot?> _loadBolsa(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    try {
      if (profile.isJefeRole || profile.vendorCodes.length > 1) {
        final grouped = await BolsaService.getGroupedStatus(
          year: now.year,
          month: now.month,
          vendedorCodes: profile.vendorCodes,
        );
        return BolsaNotificationSnapshot(
          vendorCount: grouped.vendedores.length,
          deficitCount:
              grouped.vendedores.where((item) => item.isDeficit).length,
          lowCount: grouped.vendedores.where((item) => item.isLow).length,
          available: grouped.saldoDisponible,
          consumed: grouped.consumido,
          accumulated: grouped.acumulado,
          vendorNames: grouped.vendedores
              .where((item) => item.isDeficit || item.isLow)
              .map((item) => item.vendedor)
              .take(3)
              .toList(growable: false),
        );
      }
      final code = _primaryVendorCode(profile);
      if (code.isEmpty) return null;
      final status = await BolsaService.getStatus(
        code,
        year: now.year,
        month: now.month,
      );
      return _bolsaFromStatus(status);
    } catch (e) {
      debugPrint('[Notifications] Bolsa snapshot failed: $e');
      return null;
    }
  }

  Future<SalesDayNotificationSnapshot?> _loadSalesDay(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    try {
      final params = {
        'vendedorCodes': profile.vendorCodesCsv,
        'year': now.year.toString(),
        'month': now.month.toString(),
      };
      final today = _dateKey(now);
      final results = await Future.wait<Object?>([
        ApiClient.get(
          ApiConfig.dashboardMetrics,
          queryParameters: params,
          cacheKey:
              'notifications:dashboard:metrics:${profile.scopeKey}:${now.year}:${now.month}',
          cacheTTL: const Duration(minutes: 10),
        ),
        ApiClient.get(
          ApiConfig.topClients,
          queryParameters: {...params, 'limit': '3'},
          cacheKey:
              'notifications:dashboard:top-clients:${profile.scopeKey}:${now.year}:${now.month}',
          cacheTTL: const Duration(minutes: 30),
        ),
        PedidosService.getOrderStats(
          vendedorCodes: profile.vendorCodesCsv,
          dateFrom: today,
          dateTo: today,
        ),
      ]);
      final metrics = results[0] is Map
          ? Map<String, dynamic>.from(results[0]! as Map)
          : <String, dynamic>{};
      final top = results[1] is Map
          ? Map<String, dynamic>.from(results[1]! as Map)
          : <String, dynamic>{};
      final stats = results[2] as OrderStats?;
      final clients = (top['clients'] as List? ?? top['data'] as List? ?? [])
          .whereType<Map>()
          .map((item) => item['name']?.toString() ?? '')
          .where((name) => name.trim().isNotEmpty)
          .take(3)
          .toList(growable: false);
      final dashboardSales = _toDouble(metrics['todaySales']);
      final dashboardOrders = _toInt(metrics['todayOrders']);
      return SalesDayNotificationSnapshot(
        sales: dashboardSales > 0 ? dashboardSales : stats?.totalAmount ?? 0,
        orders: dashboardOrders > 0 ? dashboardOrders : stats?.totalOrders ?? 0,
        clients: _toInt(metrics['uniqueClients']),
        margin: _toDouble(metrics['totalMargin']),
        topClientNames: clients,
      );
    } catch (e) {
      debugPrint('[Notifications] Sales day snapshot failed: $e');
      return null;
    }
  }

  Future<DeliveryNotificationSnapshot?> _loadDeliveries(
    NotificationUserProfile profile,
    DateTime now,
  ) async {
    final repartidorId = profile.deliveryCodesCsv;
    if (repartidorId.isEmpty) return null;
    try {
      final date = _dateKey(now);
      final response = await ApiClient.get(
        '/entregas/pendientes/$repartidorId?date=$date',
        cacheKey: 'notifications:deliveries:$repartidorId:$date',
        cacheTTL: const Duration(minutes: 10),
      );
      if (response['success'] != true) return null;
      final albaranes = (response['albaranes'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList(growable: false);
      final resumen = response['resumen'] is Map
          ? Map<String, dynamic>.from(response['resumen'] as Map)
          : <String, dynamic>{};
      return DeliveryNotificationSnapshot(
        date: DateTime(now.year, now.month, now.day),
        deliveryCount: albaranes.length,
        completedCount: _toInt(resumen['completedCount']),
        totalAmount: _toDouble(resumen['totalBruto']),
        cashToCollect: _toDouble(resumen['totalACobrar']),
        clientNames: albaranes
            .map(
              (item) =>
                  item['clienteNombre'] ??
                  item['cliente'] ??
                  item['nombreCliente'] ??
                  '',
            )
            .map((name) => name.toString())
            .where((name) => name.trim().isNotEmpty)
            .take(4)
            .toList(growable: false),
      );
    } catch (e) {
      debugPrint('[Notifications] Delivery snapshot failed: $e');
      return null;
    }
  }

  static BolsaNotificationSnapshot _bolsaFromStatus(BolsaStatus status) {
    return BolsaNotificationSnapshot(
      deficitCount: status.isDeficit ? 1 : 0,
      lowCount: status.isLow ? 1 : 0,
      available: status.saldoDisponible,
      consumed: status.consumido,
      accumulated: status.acumulado,
      vendorNames: status.isDeficit || status.isLow
          ? <String>[status.vendedor]
          : const [],
    );
  }

  static double _statusSales(Map<String, dynamic> client) {
    final status = client['status'] is Map
        ? Map<String, dynamic>.from(client['status'] as Map)
        : <String, dynamic>{};
    return _toDouble(status['ytdSales'] ?? status['currentMonthSales']);
  }

  static String _primaryVendorCode(NotificationUserProfile profile) {
    final codes = profile.vendorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty && code.toUpperCase() != 'ALL')
        .toList(growable: false);
    if (codes.isNotEmpty) return codes.first;
    return profile.userCode.trim();
  }

  static String _dayName(DateTime date) {
    const names = [
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
      'domingo',
    ];
    return names[date.weekday - 1];
  }

  static int _workingDaysPassed(DateTime now) {
    var days = 0;
    for (var day = 1; day <= now.day; day++) {
      if (DateTime(now.year, now.month, day).weekday != DateTime.sunday) {
        days++;
      }
    }
    return days;
  }

  static String _dateKey(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  static int _toInt(Object? value, {int fallback = 0}) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? fallback;
  }

  static double _toDouble(Object? value) {
    if (value is double) return value;
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString().replaceAll(',', '.') ?? '') ?? 0;
  }
}

class _KpiNotificationBundle {
  const _KpiNotificationBundle({this.glacius, this.clients});

  final GlaciusNotificationSnapshot? glacius;
  final ClientsNotificationSnapshot? clients;
}

class NotificationBackendSnapshotMapper {
  const NotificationBackendSnapshotMapper._();

  static NotificationSnapshot map({
    required Map<String, dynamic> body,
    required NotificationUserProfile profile,
    required OrderReminderSnapshot localOrders,
    required DateTime now,
    DeliveryNotificationSnapshot? deliveries,
  }) {
    final ordersRaw = body['orders'] is Map
        ? Map<String, dynamic>.from(body['orders'] as Map)
        : const <String, dynamic>{};
    final kpi = _kpiFrom(body['kpi']);
    return NotificationSnapshot(
      scopeKey: profile.scopeKey,
      profile: profile,
      orders: OrderReminderSnapshot(
        localDraftCount: localOrders.localDraftCount,
        localPendingCount: localOrders.localPendingCount,
        localFailedCount: localOrders.localFailedCount,
        serverDraftCount: NotificationDataRepository._toInt(ordersRaw['borrador']),
        serverPendingCount:
            NotificationDataRepository._toInt(ordersRaw['pendiente']),
        oldestAt: localOrders.oldestAt,
        clientNames: localOrders.clientNames,
      ),
      rutero: _ruteroFrom(body['ruteroHoy'], now),
      nextRutero: _ruteroFrom(
        body['ruteroManana'],
        now.add(const Duration(days: 1)),
      ),
      glacius: kpi.glacius,
      clients: kpi.clients,
      invoices: _invoicesFrom(body['facturas']),
      commissions: profile.showCommissions
          ? _commissionsFrom(body['commissions'], now)
          : null,
      bolsa: _bolsaFrom(body['bolsa']),
      salesDay: _salesDayFrom(body['metrics'], body['topClients'], body['stats']),
      deliveries: deliveries,
    );
  }

  static _KpiNotificationBundle _kpiFrom(Object? raw) {
    if (raw is! Map) return const _KpiNotificationBundle();
    final response = Map<String, dynamic>.from(raw);
    final totals = response['totals'] is Map
        ? Map<String, dynamic>.from(response['totals'] as Map)
        : <String, dynamic>{};
    final byType = (response['byType'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);
    final clients = (response['clients'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);
    var reincorporationCount = 0;
    var noPurchaseCount = 0;
    var newClientCount = 0;
    for (final item in byType) {
      final type = item['type']?.toString().toUpperCase() ?? '';
      final label = item['label']?.toString().toUpperCase() ?? '';
      final count = NotificationDataRepository._toInt(item['count']);
      final isReincorporation = type.contains('ALTA') ||
          type.contains('REINCOR') ||
          label.contains('ALTA') ||
          label.contains('REINCOR');
      if (isReincorporation) reincorporationCount += count;
      if (type.contains('SIN_COMPRA') || label.contains('SIN COMPRA')) {
        noPurchaseCount += count;
      }
      if (type.contains('ALTA') || label.contains('CLIENTE NUEVO')) {
        newClientCount += count;
      }
    }
    final clientNames = clients
        .map((item) => item['name']?.toString() ?? '')
        .where((name) => name.trim().isNotEmpty)
        .take(4)
        .toList(growable: false);
    return _KpiNotificationBundle(
      glacius: GlaciusNotificationSnapshot(
        totalAlerts: NotificationDataRepository._toInt(
          totals['alerts'] ?? totals['totalAlerts'] ?? totals['TOTAL_ALERTS'],
        ),
        criticalAlerts: NotificationDataRepository._toInt(
          totals['critical'] ?? totals['criticalAlerts'] ?? totals['CRITICAL'],
        ),
        reincorporationAlerts: reincorporationCount,
        clientNames: clientNames,
      ),
      clients: ClientsNotificationSnapshot(
        criticalAlertCount: NotificationDataRepository._toInt(
          totals['critical'] ?? totals['criticalAlerts'] ?? totals['CRITICAL'],
        ),
        warningAlertCount: NotificationDataRepository._toInt(
          totals['warning'] ?? totals['warnings'] ?? totals['WARNING'],
        ),
        noPurchaseCount: noPurchaseCount,
        newClientCount: newClientCount,
        clientNames: clientNames,
      ),
    );
  }

  static RuteroNotificationSnapshot? _ruteroFrom(Object? raw, DateTime date) {
    if (raw is! Map) return null;
    final data = Map<String, dynamic>.from(raw);
    final clients = (data['clients'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);
    final names = clients
        .map((item) => item['name']?.toString() ?? '')
        .where((name) => name.trim().isNotEmpty)
        .take(4)
        .toList(growable: false);
    return RuteroNotificationSnapshot(
      date: DateTime(date.year, date.month, date.day),
      dayName: data['day']?.toString() ?? '',
      clientCount: NotificationDataRepository._toInt(data['count']),
      clientNames: names,
    );
  }

  static InvoicesNotificationSnapshot? _invoicesFrom(Object? raw) {
    if (raw is! Map) return null;
    final data = Map<String, dynamic>.from(raw);
    final hoy = data['hoy'] is Map
        ? Map<String, dynamic>.from(data['hoy'] as Map)
        : const <String, dynamic>{};
    final mes = data['mes'] is Map
        ? Map<String, dynamic>.from(data['mes'] as Map)
        : const <String, dynamic>{};
    return InvoicesNotificationSnapshot(
      todayDocuments: NotificationDataRepository._toInt(hoy['totalDocumentos']),
      todayInvoices:
          NotificationDataRepository._toInt(hoy['totalFacturasEmitidas']),
      todayDeliveryNotes:
          NotificationDataRepository._toInt(hoy['totalAlbaranes']),
      todayAmount: NotificationDataRepository._toDouble(hoy['totalImporte']),
      monthDocuments: NotificationDataRepository._toInt(mes['totalDocumentos']),
      monthAmount: NotificationDataRepository._toDouble(mes['totalImporte']),
    );
  }

  static CommissionsNotificationSnapshot? _commissionsFrom(
    Object? raw,
    DateTime now,
  ) {
    if (raw is! Map) return null;
    final data = Map<String, dynamic>.from(raw);
    final months = data['months'] as List? ?? const [];
    final rawMonth = months.cast<dynamic>().firstWhere(
          (item) =>
              item is Map && (item['month'] as num?)?.toInt() == now.month,
          orElse: () => null,
        );
    if (rawMonth is! Map) return null;
    final month = Map<String, dynamic>.from(rawMonth);
    final ctx = month['complianceCtx'] is Map
        ? Map<String, dynamic>.from(month['complianceCtx'] as Map)
        : <String, dynamic>{};
    final payments = data['payments'] is Map
        ? Map<String, dynamic>.from(data['payments'] as Map)
        : <String, dynamic>{};
    final monthlyPaid = payments['monthly'] is Map
        ? Map<String, dynamic>.from(payments['monthly'] as Map)
        : <String, dynamic>{};
    return CommissionsNotificationSnapshot(
      month: now.month,
      currentSales: NotificationDataRepository._toDouble(month['actual']),
      monthTarget: NotificationDataRepository._toDouble(month['target']),
      monthCommission: NotificationDataRepository._toDouble(ctx['commission']),
      paidThisMonth: NotificationDataRepository._toDouble(
        monthlyPaid[now.month.toString()],
      ),
    );
  }

  static BolsaNotificationSnapshot? _bolsaFrom(Object? raw) {
    if (raw is! Map) return null;
    final data = Map<String, dynamic>.from(raw);
    final vendedores = (data['vendedores'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);
    final totals = data['totals'] is Map
        ? Map<String, dynamic>.from(data['totals'] as Map)
        : data;
    return BolsaNotificationSnapshot(
      vendorCount: NotificationDataRepository._toInt(
        data['vendorCount'] ?? vendedores.length,
        fallback: vendedores.isEmpty ? 1 : vendedores.length,
      ),
      deficitCount: NotificationDataRepository._toInt(data['deficitCount']),
      lowCount: NotificationDataRepository._toInt(data['lowCount']),
      available: NotificationDataRepository._toDouble(
        totals['saldoDisponible'] ?? data['saldoDisponible'],
      ),
      consumed: NotificationDataRepository._toDouble(
        totals['consumido'] ?? data['consumido'],
      ),
      accumulated: NotificationDataRepository._toDouble(
        totals['acumulado'] ?? data['acumulado'],
      ),
      vendorNames: vendedores
          .map((item) => (item['vendedor'] ?? item['name'] ?? '').toString())
          .where((name) => name.trim().isNotEmpty)
          .take(3)
          .toList(growable: false),
    );
  }

  static SalesDayNotificationSnapshot? _salesDayFrom(
    Object? metricsRaw,
    Object? topRaw,
    Object? statsRaw,
  ) {
    if (metricsRaw == null && topRaw == null && statsRaw == null) return null;
    final metrics = metricsRaw is Map
        ? Map<String, dynamic>.from(metricsRaw)
        : const <String, dynamic>{};
    final top = topRaw is Map
        ? Map<String, dynamic>.from(topRaw)
        : const <String, dynamic>{};
    final stats = statsRaw is Map
        ? Map<String, dynamic>.from(statsRaw)
        : const <String, dynamic>{};
    final fromList = topRaw is List ? topRaw : (top['clients'] as List? ?? top['data'] as List? ?? const []);
    final names = fromList
        .whereType<Map>()
        .map((item) => item['name']?.toString() ?? '')
        .where((name) => name.trim().isNotEmpty)
        .take(3)
        .toList(growable: false);
    final dashboardSales = NotificationDataRepository._toDouble(
      metrics['todaySales'],
    );
    final dashboardOrders = NotificationDataRepository._toInt(metrics['todayOrders']);
    return SalesDayNotificationSnapshot(
      sales: dashboardSales > 0
          ? dashboardSales
          : NotificationDataRepository._toDouble(stats['totalAmount']),
      orders: dashboardOrders > 0
          ? dashboardOrders
          : NotificationDataRepository._toInt(stats['totalOrders']),
      clients: NotificationDataRepository._toInt(metrics['uniqueClients']),
      margin: NotificationDataRepository._toDouble(metrics['totalMargin']),
      topClientNames: names,
    );
  }
}
