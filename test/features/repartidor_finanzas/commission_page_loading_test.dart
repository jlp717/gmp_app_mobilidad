import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart';

void main() {
  test('commission month requests stay within the default concurrency',
      () async {
    var active = 0;
    var peak = 0;
    final loaders = List<Future<int> Function()>.generate(7, (index) {
      return () async {
        active += 1;
        if (active > peak) peak = active;
        await Future<void>.delayed(Duration(milliseconds: 4 + index));
        active -= 1;
        return index;
      };
    });

    final rows = await runBoundedCommissionLoads(loaders);

    expect(peak, 2);
    expect(rows, <int>[0, 1, 2, 3, 4, 5, 6]);
  });

  test('commission month loader rejects a zero concurrency limit', () async {
    await expectLater(
      runBoundedCommissionLoads<int>(
        <Future<int> Function()>[],
        maxConcurrent: 0,
      ),
      throwsArgumentError,
    );
  });
}
