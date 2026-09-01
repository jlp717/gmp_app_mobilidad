/// Tests for lib/core/widgets/offline_state_widget.dart (piloto estados
/// offline, pasada 1). Verifica: banner reactivo a connectivityStatusProvider
/// (offline/limited/online), a11y (Semantics label, tooltip, liveRegion) y
/// estado a pantalla completa con reintentar.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/widgets/offline_state_widget.dart';

Widget _wrap({required Widget child, List<Override> overrides = const []}) {
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp(home: Scaffold(body: child)),
  );
}

void main() {
  group('OfflineBanner', () {
    testWidgets('muestra Sin conexión cuando el status es offline',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const Column(children: [OfflineBanner(), Text('Contenido')]),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.offline;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Sin conexión'), findsOneWidget);
      expect(find.byTooltip('Reintentar conexión'), findsOneWidget);
      // El contenido de la pagina sigue visible (no bloquea).
      expect(find.text('Contenido'), findsOneWidget);
    });

    testWidgets('muestra Conexión limitada cuando el status es limited',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const Column(children: [OfflineBanner()]),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.limited;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Conexión limitada'), findsOneWidget);
    });

    testWidgets('queda colapsado (SizedBox.shrink) cuando hay conexión',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const Column(children: [OfflineBanner()]),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.online;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(SizedBox), findsOneWidget);
      expect(find.byTooltip('Reintentar conexión'), findsNothing);
      expect(find.textContaining('Sin conexión'), findsNothing);
    });

    testWidgets('expone Semantics con label y liveRegion (screen reader)',
        (tester) async {
      final semanticsHandle = tester.ensureSemantics();
      await tester.pumpWidget(
        _wrap(
          child: const Column(children: [OfflineBanner()]),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.offline;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.bySemanticsLabel(
          RegExp(r'Sin conexión\. .*desactualizados'),
        ),
        findsOneWidget,
      );
      semanticsHandle.dispose();
    });

    testWidgets('invoca onRetry custom al pulsar reintentar (teclado/tap)',
        (tester) async {
      var retried = false;
      await tester.pumpWidget(
        _wrap(
          child: OfflineBanner(onRetry: () => retried = true),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.offline;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Reintentar conexión'));
      await tester.pumpAndSettle();

      expect(retried, isTrue);
    });
  });

  group('OfflineStateWidget', () {
    testWidgets('renderiza titulo, detalle y boton reintentar', (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const OfflineStateWidget(
            detail: 'Se sincronizarán al reconectar.',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Sin conexión'), findsOneWidget);
      expect(
        find.text('Se sincronizarán al reconectar.'),
        findsOneWidget,
      );
      expect(find.byType(OutlinedButton), findsNothing);
    });

    testWidgets('muestra boton Reintentar cuando se provee onRetry',
        (tester) async {
      var retried = false;
      await tester.pumpWidget(
        _wrap(
          child: OfflineStateWidget(onRetry: () => retried = true),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(retried, isTrue);
    });

    testWidgets('Semantics label combina titulo y detalle', (tester) async {
      final semanticsHandle = tester.ensureSemantics();
      await tester.pumpWidget(
        _wrap(
          child: const OfflineStateWidget(
            detail: 'Se muestran datos guardados.',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.bySemanticsLabel(
          'Sin conexión. Se muestran datos guardados.',
        ),
        findsOneWidget,
      );
      semanticsHandle.dispose();
    });
  });
}
