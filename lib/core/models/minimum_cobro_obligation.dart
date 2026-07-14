/// Shared minimum collection obligation contract.
library;

int _intValue(dynamic value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

String _formatThousandsEs(int value) {
  final raw = value.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < raw.length; i++) {
    final remaining = raw.length - i;
    buffer.write(raw[i]);
    if (remaining > 1 && remaining % 3 == 1) buffer.write('.');
  }
  return value < 0 ? '-$buffer' : buffer.toString();
}

enum MinimumCobroObligationBanner {
  none,
  success,
  warning,
}

class MinimumCobroObligation {
  const MinimumCobroObligation({
    this.minimumPercent = 0,
    this.collectableCents = 0,
    this.registeredCents = 0,
    this.remainingCents = 0,
    this.met = true,
  });

  factory MinimumCobroObligation.fromJson(Map<String, dynamic> json) {
    return MinimumCobroObligation(
      minimumPercent: _intValue(json['minimumPercent']),
      collectableCents: _intValue(json['collectableCents']),
      registeredCents: _intValue(json['registeredCents']),
      remainingCents: _intValue(json['remainingCents']),
      met: json['met'] != false,
    );
  }

  final int minimumPercent;
  final int collectableCents;
  final int registeredCents;
  final int remainingCents;
  final bool met;

  int get requiredCents => (collectableCents * minimumPercent / 100).ceil();

  double get progress {
    if (requiredCents <= 0) return met ? 1 : 0;
    return registeredCents / requiredCents;
  }

  MinimumCobroObligationBanner get bannerLevel {
    if (met) return MinimumCobroObligationBanner.success;
    if (remainingCents > 0) return MinimumCobroObligationBanner.warning;
    return MinimumCobroObligationBanner.none;
  }

  String get bannerText {
    if (met) return 'Minimo de cobro cumplido';
    return 'Faltan ${_formatThousandsEs(remainingCents)} para cumplir el minimo';
  }
}
