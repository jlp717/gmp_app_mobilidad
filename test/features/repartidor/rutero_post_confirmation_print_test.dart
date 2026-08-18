import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';

void main() {
  test('una impresora colgada no bloquea compartir el recibo', () async {
    final printStarted = Completer<void>();
    final neverCompletes = Completer<void>();
    var shareCalls = 0;

    await runRuteroPostConfirmationEffects(
      shouldPrint: true,
      printTicket: () {
        printStarted.complete();
        return neverCompletes.future;
      },
      shareReceipt: () async {
        shareCalls += 1;
      },
    );

    await printStarted.future.timeout(const Duration(milliseconds: 100));
    expect(shareCalls, 1);
  });

  test('un fallo de impresion best-effort no impide compartir ni completar',
      () async {
    var shareCalls = 0;

    await runRuteroPostConfirmationEffects(
      shouldPrint: true,
      printTicket: () => Future<void>.error(StateError('printer offline')),
      shareReceipt: () async {
        shareCalls += 1;
      },
    );

    await Future<void>.delayed(Duration.zero);
    expect(shareCalls, 1);
  });
}
