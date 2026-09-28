/// Canonical monetary value object for GMP.
library;

import 'package:flutter/foundation.dart';
///
/// All money in the domain is an integer number of cents ([cents], int64)./// Domain arithmetic (+, -, *) stays in cents: exact, no binary-float drift.
///
/// Rounding policy (explicit): half-away-from-zero.
/// - [Money.tryParse]/[Money.parse] work on the exact decimal string, so
///   `'2.345'` -> 235 cents and `'-2.345'` -> -235 cents.
/// - [Money.fromDouble] inherits the caller's binary-float representation:
///   `2.345` as `double` is really `2.3449999...`, so it becomes 234 cents.
///   Prefer [Money.fromCents] or string parsing for user input and wire data.
/// - `operator *` with a `double` factor rounds the exact product
///   half-away-from-zero (same binary-float caveat applies to the factor).
///
/// Boundary rule (N/N-1 backend compat): JSON/API wire format does NOT
/// change. [toJson] emits the same `double` numbers as before; [toDouble]
/// exists ONLY for render (widgets, PDF, JSON) — never for domain math.
@immutable
class Money implements Comparable<Money> {
  /// Creates money from an exact cent count.
  factory Money.fromCents(int cents) => Money._(cents);

  /// Creates money from a `double`, rounding to the nearest cent
  /// (half-away-from-zero on the binary value actually received).
  ///
  /// Throws [ArgumentError] for NaN/infinite input.
  factory Money.fromDouble(double value) {
    if (value.isNaN || !value.isFinite) {
      throw ArgumentError.value(value, 'value', 'Debe ser finito');
    }
    return Money._((value * 100).round());
  }

  /// Parses ES/international decimal text (`'1.234,56'`, `'1,234.56'`,
  /// `'1234.56'`, `'12,3'`). Returns `null` for empty/invalid text.
  ///
  /// A single separator is always the decimal mark (parity with the legacy
  /// `parseAmount`); when both are present the last one is the decimal mark
  /// and the other is stripped as thousands. Rounding of extra decimals is
  /// half-away-from-zero on the exact decimal string.
  static Money? tryParse(String input) {
    var text = input.trim().replaceAll(' ', '');
    if (text.isEmpty) return null;
    var negative = false;
    if (text.startsWith('-') || text.startsWith('+')) {
      negative = text.startsWith('-');
      text = text.substring(1);
    }
    if (text.isEmpty) return null;

    final comma = text.lastIndexOf(',');
    final dot = text.lastIndexOf('.');
    String intPart;
    String fracPart;
    if (comma != -1 && dot != -1) {
      final decimal = comma > dot ? ',' : '.';
      final thousands = comma > dot ? '.' : ',';
      text = text.replaceAll(thousands, '');
      final parts = text.split(decimal);
      if (parts.length != 2) return null;
      intPart = parts[0];
      fracPart = parts[1];
    } else if (comma != -1 || dot != -1) {
      final parts = text.split(comma != -1 ? ',' : '.');
      if (parts.length != 2) return null;
      intPart = parts[0];
      fracPart = parts[1];
    } else {
      intPart = text;
      fracPart = '';
    }

    final digits = RegExp(r'^\d+$');
    if (intPart.isEmpty && fracPart.isEmpty) return null;
    if (intPart.isNotEmpty && !digits.hasMatch(intPart)) return null;
    if (fracPart.isNotEmpty && !digits.hasMatch(fracPart)) return null;

    final euros = intPart.isEmpty ? 0 : int.parse(intPart);
    var cents = euros * 100;
    if (fracPart.isNotEmpty) {
      final firstTwo = (fracPart + '00').substring(0, 2);
      cents += int.parse(firstTwo);
      // Third decimal digit on the exact string: >= 5 rounds the cent up
      // (half-away-from-zero; applied with the sign below).
      if (fracPart.length > 2 && fracPart.codeUnitAt(2) >= 0x35) {
        cents += 1;
      }
    }
    return Money._(negative ? -cents : cents);
  }

  /// Parses like [tryParse] but throws [FormatException] on invalid text.
  factory Money.parse(String input) {
    final parsed = Money.tryParse(input);
    if (parsed == null) {
      throw FormatException('Importe invalido: $input');
    }
    return parsed;
  }

  /// Lenient wire reader: `num` via [Money.fromDouble], `String` via
  /// [Money.tryParse] (invalid -> [fallback]), anything else -> [fallback].
  static Money moneyValue(dynamic value, {Money fallback = Money.zero}) {
    if (value is num) return Money.fromDouble(value.toDouble());
    if (value is String) return Money.tryParse(value) ?? fallback;
    return fallback;
  }

  const Money._(this.cents);

  /// Exact cent count. The single source of truth for domain math.
  final int cents;

  /// Exact zero. Prefer over `Money.fromDouble(0)`.
  static const Money zero = Money._(0);

  /// Exact cent-exact addition.
  Money operator +(Money other) => Money._(cents + other.cents);

  /// Exact cent-exact subtraction.
  Money operator -(Money other) => Money._(cents - other.cents);

  /// Scale by [factor]. `int` factors are exact; `double` factors round the
  /// product half-away-from-zero (binary-float caveat, see class docs).
  Money operator *(num factor) {
    if (factor is int) return Money._(cents * factor);
    return Money._((cents * factor).round());
  }

  /// Negation.
  Money operator -() => Money._(-cents);

  /// Absolute value.
  Money abs() => cents < 0 ? Money._(-cents) : this;

  /// True when exactly zero cents.
  bool get isZero => cents == 0;

  /// True when below zero.
  bool get isNegative => cents < 0;

  /// True when above zero.
  bool get isPositive => cents > 0;

  @override
  int compareTo(Money other) => cents.compareTo(other.cents);

  /// Renders `12,30`, `1.234,56`, `-4,00` (manual ES format, no intl).
  String toStringES() {
    final abs = cents.abs();
    final euros = abs ~/ 100;
    final rest = (abs % 100).toString().padLeft(2, '0');
    final raw = euros.toString();
    final buffer = StringBuffer();
    for (var i = 0; i < raw.length; i++) {
      if (i > 0 && (raw.length - i) % 3 == 0) buffer.write('.');
      buffer.write(raw[i]);
    }
    return '${cents < 0 ? '-' : ''}${buffer.toString()},$rest';
  }

  /// Render/wire ONLY (widgets, PDF, JSON numbers). Never domain math:
  /// the `double` comeback reintroduces binary drift.
  double toDouble() => cents / 100.0;

  /// Wire format, unchanged vs legacy: same `double` numbers as before
  /// (backend N/N-1 compat).
  double toJson() => toDouble();

  /// Cent-exact greater-than.
  bool operator >(Money other) => cents > other.cents;

  /// Cent-exact greater-than-or-equal.
  bool operator >=(Money other) => cents >= other.cents;

  /// Cent-exact less-than.
  bool operator <(Money other) => cents < other.cents;

  /// Cent-exact less-than-or-equal.
  bool operator <=(Money other) => cents <= other.cents;

  @override
  bool operator ==(Object other) => other is Money && other.cents == cents;

  @override
  int get hashCode => cents.hashCode;

  @override
  String toString() => 'Money(${toStringES()})';
}
