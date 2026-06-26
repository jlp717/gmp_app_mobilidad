import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:gmp_app_mobilidad/core/services/session_scope.dart';
import 'package:gmp_app_mobilidad/features/objectives/data/objectives_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class NotificationSessionStore {
  const NotificationSessionStore._();

  static NotificationUserProfile fromUser(
    UserModel user,
    List<String> vendedorCodes,
  ) {
    return NotificationUserProfile(
      userCode: user.code,
      role: user.role,
      isJefeVentas: user.isJefeVentas,
      vendorCodes: vendedorCodes,
      userName: user.name,
    );
  }

  static Future<NotificationUserProfile?> loadStoredProfile() async {
    final token = await SecureStorage.readSecureData('user_token');
    final userDataStr = await SecureStorage.readSecureData('user_data');
    if (token == null ||
        token.isEmpty ||
        userDataStr == null ||
        userDataStr.isEmpty) {
      return null;
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final user = UserModel.fromJson(
        jsonDecode(userDataStr) as Map<String, dynamic>,
      );
      final vendedorCodes = prefs.getStringList('vendedor_codes') ?? <String>[];
      ApiClient.setAuthToken(token);
      SessionScope.apply(user, vendedorCodes);
      return fromUser(user, vendedorCodes);
    } catch (e) {
      debugPrint('[Notifications] Stored profile unavailable: $e');
      return null;
    }
  }
}

class NotificationDataRepository {
  const NotificationDataRepository();

  Future<NotificationSnapshot> loadSnapshot({
    required NotificationUserProfile? profile,
    DateTime? now,
  }) async {
    final effectiveNow = now ?? DateTime.now();
    final orders = await _loadOrders(profile: profile);

    if (profile == null || profile.isRepartidor) {
      return NotificationSnapshot(
        scopeKey: profile?.scopeKey ?? 'anon',
        orders: orders,
      );
    }

    final results = await Future.wait<Object?>([
      _loadObjectives(profile, effectiveNow),
      _loadRutero(profile, effectiveNow),
      _loadGlacius(profile),
    ]);

    return NotificationSnapshot(
      scopeKey: profile.scopeKey,
      orders: orders,
      objectives: results[0] as ObjectivesNotificationSnapshot?,
      rutero: results[1] as RuteroNotificationSnapshot?,
      glacius: results[2] as GlaciusNotificationSnapshot?,
    );
  }

  Future<OrderReminderSnapshot> _loadOrders({
    required NotificationUserProfile? profile,
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
    if (profile != null && !profile.isRepartidor) {
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
      if (daysPassed <= 0) {
        daysPassed = _workingDaysPassed(now);
      }
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
    DateTime now,
  ) async {
    try {
      final dayName = _dayName(now);
      final week = ((now.day + now.weekday - 2) ~/ 7) + 1;
      final response = await ApiClient.get(
        '${ApiConfig.ruteroDay}/$dayName',
        queryParameters: {
          'vendedorCodes': profile.vendorCodesCsv,
          'role': 'comercial',
          'year': now.year,
          'month': now.month,
          'week': week,
        },
        cacheKey: [
          'notifications',
          'rutero_day',
          profile.scopeKey,
          now.year,
          now.month,
          week,
          dayName,
        ].join(':'),
        cacheTTL: const Duration(minutes: 30),
      );
      final clients = (response['clients'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
      final names = clients
          .map((item) => item['name']?.toString() ?? '')
          .where((name) => name.trim().isNotEmpty)
          .take(4)
          .toList(growable: false);
      return RuteroNotificationSnapshot(
        date: DateTime(now.year, now.month, now.day),
        dayName: dayName,
        clientCount: clients.length,
        clientNames: names,
      );
    } catch (e) {
      debugPrint('[Notifications] Rutero snapshot failed: $e');
      return null;
    }
  }

  Future<GlaciusNotificationSnapshot?> _loadGlacius(
    NotificationUserProfile profile,
  ) async {
    try {
      final response = await ApiClient.get(
        ApiConfig.kpiDashboard,
        queryParameters: {'vendorCode': profile.vendorCodesCsv},
        cacheKey: 'notifications:kpi_dashboard:${profile.scopeKey}',
        cacheTTL: const Duration(minutes: 30),
      );
      if (response['success'] != true) return null;
      final totals = response['totals'] is Map
          ? Map<String, dynamic>.from(response['totals'] as Map)
          : <String, dynamic>{};
      final byType = (response['byType'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
      final clients = (response['clients'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);

      final reincorporationCount = byType.fold<int>(0, (sum, item) {
        final type = item['type']?.toString().toUpperCase() ?? '';
        final label = item['label']?.toString().toUpperCase() ?? '';
        final matches = type.contains('ALTA') ||
            type.contains('REINCOR') ||
            label.contains('ALTA') ||
            label.contains('REINCOR');
        return matches ? sum + _toInt(item['count']) : sum;
      });

      return GlaciusNotificationSnapshot(
        totalAlerts: _toInt(totals['alerts'] ?? totals['totalAlerts']),
        criticalAlerts: _toInt(totals['critical'] ?? totals['criticalAlerts']),
        reincorporationAlerts: reincorporationCount,
        clientNames: clients
            .map((item) => item['name']?.toString() ?? '')
            .where((name) => name.trim().isNotEmpty)
            .take(4)
            .toList(growable: false),
      );
    } catch (e) {
      debugPrint('[Notifications] Glacius snapshot failed: $e');
      return null;
    }
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
