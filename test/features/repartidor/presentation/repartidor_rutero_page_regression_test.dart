import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_rutero_page.dart';
import 'package:intl/date_symbol_data_local.dart';

class _TestAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async => const AuthState(isInitialized: true);
}

class _TestEntregasNotifier extends EntregasNotifier {
  @override
  EntregasState build() => EntregasState();

  @override
  void setRepartidor(String repartidorId,
      {bool autoReload = true, bool forceReload = false}) {}

  @override
  void seleccionarFecha(DateTime fecha,
      {bool forceRefresh = false, bool autoReload = true}) {}

  @override
  Future<void> cargarAlbaranesPendientes(
      {bool forceRefresh = false, bool append = false}) async {}
}

Widget _page(RepartidorRuteroWeekLoader loader) => ProviderScope(
      overrides: [
        authProvider.overrideWith(_TestAuthNotifier.new),
        entregasProvider.overrideWith(_TestEntregasNotifier.new),
      ],
      child: MaterialApp(
        home: RepartidorRuteroPage(
          repartidorId: 'R1',
          repartidoresLoader: () async => const [],
          weekLoader: loader,
        ),
      ),
    );

Future<void> _start(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump();
}

void main() {
  setUpAll(() => initializeDateFormatting('es_ES'));

  testWidgets('success false clears week and exposes a retry action',
      (tester) async {
    var calls = 0;
    await tester.pumpWidget(_page((
        {required repartidorId, required date, required forceRefresh}) async {
      calls++;
      return {'success': false};
    }));
    await _start(tester);

    expect(find.byKey(const ValueKey('week-load-retry')), findsOneWidget);
    expect(find.text('No se pudo cargar la semana de reparto'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('week-load-retry')));
    await tester.pump();
    expect(calls, 2);
  });

  testWidgets('week loader exception exposes the same retry action',
      (tester) async {
    await tester.pumpWidget(_page((
        {required repartidorId, required date, required forceRefresh}) async {
      throw StateError('network');
    }));
    await _start(tester);

    expect(find.byKey(const ValueKey('week-load-retry')), findsOneWidget);
    expect(find.text('No se pudo cargar la semana de reparto'), findsOneWidget);
  });

  testWidgets('week loader exception never exposes diagnostic data',
      (tester) async {
    const hostile =
        'SQLSTATE=08001 /private/reparto/42?dni=12345678Z Bearer token-123';
    await tester.pumpWidget(_page((
        {required repartidorId, required date, required forceRefresh}) async {
      throw StateError(hostile);
    }));
    await _start(tester);

    expect(find.text('No se pudo cargar la semana de reparto'), findsOneWidget);
    expect(find.textContaining('SQLSTATE'), findsNothing);
    expect(find.textContaining('/private/'), findsNothing);
    expect(find.textContaining('12345678Z'), findsNothing);
    expect(find.textContaining('token-123'), findsNothing);
  });
}
