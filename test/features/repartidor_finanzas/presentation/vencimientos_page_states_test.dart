import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';

RepartidorVencimientosBatch _batch(List<RepartidorVencimiento> items) {
  return RepartidorVencimientosBatch(
    items: items,
    total: items.length,
    hasMore: false,
    nextCursor: null,
  );
}

RepartidorVencimiento _vencimiento({
  required String documento,
  required DateTime fecha,
}) {
  return RepartidorVencimiento(
    tipoDocumento: 'FAC',
    codigoCliente: '4321',
    nombreCliente: 'Cliente Prueba SL',
    fechaVencimiento:
        '${fecha.year.toString().padLeft(4, '0')}-${fecha.month.toString().padLeft(2, '0')}-${fecha.day.toString().padLeft(2, '0')}',
    documento: documento,
    importe: 150,
    importePendiente: 120.5,
  );
}

Future<void> _pump(
  WidgetTester tester, {
  required String repartidorId,
  required Future<RepartidorVencimientosBatch> Function() stub,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        repartidorVencimientosProvider.overrideWith((ref, arg) => stub()),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: RepartidorVencimientosPage(repartidorId: repartidorId),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('estado loading muestra spinner mientras carga', (tester) async {
    await _pump(
      tester,
      repartidorId: 'R1',
      stub: () => Completer<RepartidorVencimientosBatch>().future,
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('estado exito renderiza documentos agrupados por estado',
      (tester) async {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    await _pump(
      tester,
      repartidorId: 'R1',
      stub: () async => _batch([
        _vencimiento(documento: 'F-001', fecha: yesterday),
      ]),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    await tester.drag(find.byType(ListView), const Offset(0, -1000));
    await tester.pumpAndSettle();
    expect(find.textContaining('F-001'), findsOneWidget);
    expect(find.textContaining('Cliente Prueba SL'), findsWidgets);
    expect(find.text('Vencidos'), findsOneWidget);
  });

  testWidgets('estado error muestra mensaje y boton Reintentar',
      (tester) async {
    await _pump(
      tester,
      repartidorId: 'R1',
      stub: () async => throw Exception('boom'),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    expect(
      find.text('No se pudieron cargar los vencimientos'),
      findsOneWidget,
    );
    expect(find.text('Reintentar'), findsOneWidget);
  });

  testWidgets('sin repartidor muestra placeholder y no consulta',
      (tester) async {
    var queried = false;
    await _pump(
      tester,
      repartidorId: '',
      stub: () {
        queried = true;
        return Completer<RepartidorVencimientosBatch>().future;
      },
    );
    await tester.pump();

    expect(
      find.text('Selecciona un repartidor para consultar vencimientos'),
      findsOneWidget,
    );
    expect(queried, isFalse);
  });
}
