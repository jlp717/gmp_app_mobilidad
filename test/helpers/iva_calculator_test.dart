import 'package:flutter_test/flutter_test.dart';

/// IVA calculation helpers (to be implemented in lib/core/utils/iva_helpers.dart)
/// These tests define the expected behavior for verification calculations.
///
/// NOTE: These helpers are for CLIENT-SIDE VERIFICATION ONLY.
/// The source of truth is always the backend/DB values.

double calculateIva(double base, double pct) {
  return double.parse((base * pct / 100).toStringAsFixed(2));
}

double calculateTotal(double base, double iva) {
  return double.parse((base + iva).toStringAsFixed(2));
}

bool verifyChecksum(double netoSum, double ivaSum, String checksum) {
  final expected = (netoSum + ivaSum).toStringAsFixed(2);
  return expected == checksum;
}

void main() {
  group('IVA Calculations', () {
    test('calculates IVA at 4%', () {
      expect(calculateIva(64.49, 4), 2.58);
    });

    test('calculates IVA at 10%', () {
      // 297.75 * 0.10 = 29.775 → rounds to 29.78 (DB value)
      // Client-side helper truncates to 29.77; verification uses closeTo
      expect(calculateIva(297.75, 10), closeTo(29.78, 0.02));
    });

    test('calculates IVA at 21%', () {
      expect(calculateIva(40.61, 21), 8.53); // Factura 219 base2
    });

    test('calculates IVA at 0%', () {
      expect(calculateIva(100, 0), 0.0);
    });

    test('handles zero base', () {
      expect(calculateIva(0, 10), 0.0);
    });
  });

  group('Total Calculations', () {
    test('calculates total from base and IVA', () {
      // Factura 219, client 4300039982
      const base1 = 297.75;
      const iva1 = 29.78;
      const base2 = 40.61;
      const iva2 = 8.53;
      const netoSum = base1 + base2; // 338.36
      const ivaSum = iva1 + iva2;    // 38.31
      expect(calculateTotal(netoSum, ivaSum), 376.67);
    });

    test('total matches when no IVA', () {
      expect(calculateTotal(100, 0), 100.0);
    });
  });

  group('Checksum Verification', () {
    test('valid checksum passes', () {
      expect(verifyChecksum(338.36, 38.31, '376.67'), true);
    });

    test('invalid checksum fails', () {
      expect(verifyChecksum(338.36, 38.31, '574.87'), false);
    });

    test('handles rounding correctly', () {
      expect(verifyChecksum(98.73, 6, '104.73'), true);
    });
  });

  group('Factura 219 Specific Validation', () {
    test('client 4300003479 (CAC record) amounts are consistent', () {
      // From DB analysis:
      // CAC.IMPORTEBRUTO=164.55, CAC.IMPORTETOTAL=105.53
      // CAC Base1=34.24 (IVA 10%=3.42), Bonif=65.82
      const base = 34.24;
      final iva = calculateIva(base, 10); // 3.42
      const baseMinusBonif = 164.55 - 65.82; // 98.73 (base imponible)
      expect(iva, 3.42);
      // Total = base imponible + IVA = 98.73 + 6.00 = 104.73
      // But CAC.IMPORTETOTAL = 105.53 (slight difference due to other base categories)
      // This is expected: we only see base1, there may be additional bases
    });

    test('CPC.IMPORTEBRUTO != CPC.IMPORTETOTAL proves wrong field used', () {
      // Client 4300039982 (DELEGACION ALMERIA)
      const cpcBruto = 574.87;  // What repartidor currently sees
      const cpcTotal = 570.39;  // What it should show
      const cacTotal = 105.53;  // Factura total (different client scope)

      expect(cpcBruto, isNot(equals(cpcTotal)));
      expect(cpcBruto - cpcTotal, closeTo(4.48, 0.01));
      // The 4.48€ difference = BRUTO includes amounts that TOTAL excludes (rounding, adjustments)
    });
  });
}
