/// Professional caption that travels with a shared PDF.
///
/// The amount is the document total in euros. The text never breaks that
/// total into base and VAT: the PDF already does.
class DocumentShareMessage {
  DocumentShareMessage._();

  static const closing = 'Quedamos a su disposición.\n'
      'Un cordial saludo,\n'
      'Granja Mari Pepa';

  /// Keeps a typed caption. An empty field falls back to [fallback].
  static String captionOrDefault(String typed, String fallback) {
    final text = typed.trim();
    return text.isEmpty ? fallback : text;
  }

  static String greeting({DateTime? now}) {
    final hour = (now ?? DateTime.now()).hour;
    if (hour < 14) return 'Buenos días';
    if (hour < 21) return 'Buenas tardes';
    return 'Buenas noches';
  }

  static String euros(num amount) {
    final negative = amount < 0;
    final fixed = amount.abs().toStringAsFixed(2);
    final parts = fixed.split('.');
    final digits = parts[0];
    final grouped = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      final left = digits.length - i;
      if (i > 0 && left % 3 == 0) grouped.write('.');
      grouped.write(digits[i]);
    }
    return '${negative ? '-' : ''}$grouped,${parts[1]} €';
  }

  static String displayDate(Object? raw) {
    if (raw is DateTime) {
      return '${_two(raw.day)}/${_two(raw.month)}/${raw.year}';
    }
    final text = (raw ?? '').toString().trim();
    if (text.isEmpty) return '';
    final iso = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(text);
    if (iso != null) {
      return '${iso.group(3)}/${iso.group(2)}/${iso.group(1)}';
    }
    final slash = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(text);
    if (slash != null) {
      return '${slash.group(1)!.padLeft(2, '0')}/'
          '${slash.group(2)!.padLeft(2, '0')}/'
          '${slash.group(3)}';
    }
    return text;
  }

  static String commercial({
    required String clientName,
    required bool isInvoice,
    required String documentLabel,
    required num totalWithVat,
    Object? date,
    String? albaranLabel,
    DateTime? now,
  }) {
    final hello = _hello(clientName, now);
    final label = documentLabel.trim();
    final when = displayDate(date);
    final money = euros(totalWithVat);
    final albaran = (albaranLabel ?? '').trim();
    final String sentence;
    if (isInvoice && albaran.isNotEmpty) {
      final emitted = when.isEmpty ? '' : ', emitido el $when';
      sentence = '$hello le enviamos su factura $label, '
          'correspondiente al albarán $albaran$emitted, '
          'por un importe de $money.';
    } else if (isInvoice) {
      final emitted = when.isEmpty ? '' : ', emitida el $when';
      sentence = '$hello le enviamos su factura $label$emitted, '
          'por un importe de $money.';
    } else {
      final emitted = when.isEmpty ? '' : ', emitido el $when';
      sentence = '$hello le enviamos su albarán $label$emitted, '
          'por un importe de $money.';
    }
    return '$sentence\n\n$closing';
  }

  static String deliveryNote({
    required String clientName,
    required String albaranLabel,
    required num totalWithVat,
    Object? date,
    DateTime? now,
  }) {
    final hello = _hello(clientName, now);
    final label = albaranLabel.trim();
    final when = displayDate(date);
    final emitted = when.isEmpty ? '' : ', emitido el $when';
    final money = euros(totalWithVat);
    return '$hello le enviamos la nota de entrega del albarán '
        '$label$emitted, por un importe de $money.\n\n$closing';
  }

  static String productSheet({
    required String productName,
    String? clientName,
    String? productCode,
    DateTime? now,
  }) {
    final hello = _hello(clientName, now);
    final name = productName.trim().isEmpty ? 'producto' : productName.trim();
    final code = (productCode ?? '').trim();
    final reference = code.isEmpty ? '' : ', referencia $code';
    return '$hello le enviamos la ficha técnica de $name$reference.\n\n'
        '$closing';
  }

  static String settlement({
    Object? date,
    DateTime? now,
  }) {
    final when = displayDate(date);
    final hello = greeting(now: now);
    final dated = when.isEmpty ? '' : ' del $when';
    return '$hello, le enviamos la liquidación diaria$dated.\n\n$closing';
  }

  static String _hello(String? clientName, DateTime? now) {
    final greet = greeting(now: now);
    final name = (clientName ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (name.isEmpty || name.toLowerCase() == 'cliente') return '$greet,';
    return '$greet, $name,';
  }

  static String _two(int value) => value.toString().padLeft(2, '0');
}
