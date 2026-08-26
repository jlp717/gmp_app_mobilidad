// GMP Filter Provider Tests
import 'package:flutter_test/flutter_test.dart';

class FilterState {
  FilterState({
    this.selectedVendor,
    this.dateRange,
  });
  final String? selectedVendor;
  final DateTimeRange? dateRange;

  FilterState copyWith({
    String? selectedVendor,
    DateTimeRange? dateRange,
  }) {
    return FilterState(
      selectedVendor: selectedVendor ?? this.selectedVendor,
      dateRange: dateRange ?? this.dateRange,
    );
  }

  FilterState reset() {
    return FilterState();
  }
}

class DateTimeRange {
  DateTimeRange({required this.start, required this.end});
  final DateTime start;
  final DateTime end;
}

void main() {
  group('FilterState Tests', () {
    test('creates with default values', () {
      final filter = FilterState();
      expect(filter.selectedVendor, isNull);
      expect(filter.dateRange, isNull);
    });

    test('creates with vendor', () {
      final filter = FilterState(selectedVendor: '01,02');
      expect(filter.selectedVendor, '01,02');
    });

    test('copyWith preserves unchanged values', () {
      final filter = FilterState(selectedVendor: '01');
      final newFilter = filter.copyWith(
        dateRange: DateTimeRange(
          start: DateTime(2024, 1, 1),
          end: DateTime(2024, 12, 31),
        ),
      );

      expect(newFilter.selectedVendor, '01');
      expect(newFilter.dateRange, isNotNull);
    });

    test('reset clears all values', () {
      final filter = FilterState(selectedVendor: '01');
      final reset = filter.reset();

      expect(reset.selectedVendor, isNull);
      expect(reset.dateRange, isNull);
    });

    test('copyWith with null preserves current value', () {
      final filter = FilterState(selectedVendor: '01');
      final newFilter = filter.copyWith();

      expect(newFilter.selectedVendor, '01');
    });
  });

  group('DateTimeRange Tests', () {
    test('creates with start and end', () {
      final range = DateTimeRange(
        start: DateTime(2024, 1, 1),
        end: DateTime(2024, 12, 31),
      );

      expect(range.start.year, 2024);
      expect(range.end.year, 2024);
    });
  });
}
