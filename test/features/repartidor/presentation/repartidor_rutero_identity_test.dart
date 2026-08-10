import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_rutero_page.dart';
import 'package:intl/date_symbol_data_local.dart';

class _JefeRepartidorAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async => AuthState(
        isInitialized: true,
        user: const UserModel(
          id: 'test-jefe',
          code: 'J1',
          name: 'Jefe',
          company: 'GMP',
          role: 'REPARTIDOR',
          isJefeVentas: true,
        ),
      );
}

class _SelectedRepartidorFilterNotifier extends FilterNotifier {
  @override
  FilterState build() => const FilterState(selectedVendor: 'R2');
}

class _IdentityTestEntregasNotifier extends EntregasNotifier {
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

Widget _jefePage({
  required RepartidorRuteroListLoader repartidoresLoader,
  required RepartidorRuteroWeekLoader weekLoader,
  Map<String, String>? names,
}) =>
    ProviderScope(
      overrides: [
        authProvider.overrideWith(_JefeRepartidorAuthNotifier.new),
        filterProvider.overrideWith(_SelectedRepartidorFilterNotifier.new),
        selectedVendorProvider.overrideWithValue('R2'),
        entregasProvider.overrideWith(_IdentityTestEntregasNotifier.new),
      ],
      child: MaterialApp(
        home: RepartidorRuteroPage(
          repartidorId: 'R2',
          repartidorNames: names,
          repartidoresLoader: repartidoresLoader,
          weekLoader: weekLoader,
        ),
      ),
    );

Widget _noIdentityPage(RepartidorRuteroWeekLoader weekLoader) => ProviderScope(
      overrides: [
        entregasProvider.overrideWith(_IdentityTestEntregasNotifier.new),
      ],
      child: MaterialApp(
        home: RepartidorRuteroPage(
          repartidoresLoader: () async => const [],
          weekLoader: weekLoader,
        ),
      ),
    );

Future<void> _start(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump();
}

void main() {
  setUpAll(() => initializeDateFormatting('es_ES'));

  testWidgets('jefe sees the loaded repartidor name in the rutero header',
      (tester) async {
    await tester.pumpWidget(
      _jefePage(
        names: const {'R2': 'Ana López'},
        repartidoresLoader: () async => const [
          {'code': 'R2', 'name': 'Ana López'},
        ],
        weekLoader: (
            {required repartidorId,
            required date,
            required forceRefresh}) async {
          return {'success': true, 'days': const []};
        },
      ),
    );
    await _start(tester);

    final header = tester.widget<SmartSyncHeader>(
      find.byType(SmartSyncHeader),
    );
    expect(header.subtitle, 'Ana López');
    expect(find.text('Repartidor R2'), findsNothing);
  });

  testWidgets('repartidores failure is safe and retryable', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      _jefePage(
        repartidoresLoader: () async {
          calls++;
          if (calls == 1) throw StateError('sensitive transport failure');
          return const [];
        },
        weekLoader: (
            {required repartidorId,
            required date,
            required forceRefresh}) async {
          return {'success': true, 'days': const []};
        },
      ),
    );
    await _start(tester);

    expect(find.text('No se ha podido cargar la lista de repartidores.'),
        findsOneWidget);
    expect(find.textContaining('sensitive transport failure'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('repartidores-load-retry')));
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pump();
    expect(calls, 2);
  });

  testWidgets('missing effective identity exposes retry without loading data',
      (tester) async {
    var weekCalls = 0;
    await tester.pumpWidget(
      _noIdentityPage((
          {required repartidorId, required date, required forceRefresh}) async {
        weekCalls++;
        return {'success': true, 'days': const []};
      }),
    );
    await _start(tester);

    expect(find.byKey(const ValueKey('rutero-identity-error')), findsOneWidget);
    expect(find.byKey(const ValueKey('rutero-identity-retry')), findsOneWidget);
    expect(weekCalls, 0);
  });
}
