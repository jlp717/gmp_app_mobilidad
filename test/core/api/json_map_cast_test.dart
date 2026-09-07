import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/json_map_cast.dart';

void main() {
  group('isBulkyJsonMap', () {
    test('detects large rows payload', () {
      expect(
        isBulkyJsonMap({
          'rows': List.generate(80, (i) => {'id': i}),
        }),
        isTrue,
      );
    });

    test('detects clients, data and items aliases', () {
      expect(
        isBulkyJsonMap({
          'clients': List.generate(80, (i) => {'id': i}),
        }),
        isTrue,
      );
      expect(
        isBulkyJsonMap({
          'data': List.generate(80, (i) => {'id': i}),
        }),
        isTrue,
      );
      expect(
        isBulkyJsonMap({
          'items': List.generate(80, (i) => {'id': i}),
        }),
        isTrue,
      );
    });

    test('ignores small payloads', () {
      expect(
        isBulkyJsonMap({
          'rows': List.generate(10, (i) => {'id': i}),
        }),
        isFalse,
      );
      expect(isBulkyJsonMap({}), isFalse);
    });
  });

  group('castResponseMap', () {
    test('returns typed map without copy', () {
      final src = <String, dynamic>{'ok': true};
      expect(identical(castResponseMap(src), src), isTrue);
    });

    test('deep-casts dynamic hive maps', () {
      final src = <dynamic, dynamic>{
        'rows': [
          <dynamic, dynamic>{'YEAR': 2026},
        ],
      };
      final out = castResponseMap(src);
      expect(out['rows'], isA<List>());
      expect((out['rows'] as List).first, isA<Map<String, dynamic>>());
    });

    test('preserves null leaves from DB2 payloads', () {
      final out = castResponseMap(<dynamic, dynamic>{
        'importe': null,
        'nested': <dynamic, dynamic>{'serie': null},
      });
      expect(out['importe'], isNull);
      expect((out['nested'] as Map<String, dynamic>)['serie'], isNull);
    });

    test('throws on non-map input', () {
      expect(() => castResponseMap('not-a-map'), throwsArgumentError);
      expect(() => castResponseMap(42), throwsArgumentError);
      expect(() => castResponseMap(true), throwsArgumentError);
      expect(() => castResponseMap(<dynamic>[]), throwsArgumentError);
      expect(
          () => castResponseMap(<Map<String, dynamic>>[]), throwsArgumentError);
      expect(() => castResponseMap(Object()), throwsArgumentError);
    });
  });

  group('deepCastJsonMap', () {
    test('stringifies dynamic keys recursively', () {
      final out = deepCastJsonMap(<dynamic, dynamic>{
        1: <dynamic, dynamic>{'a': 1},
      });
      expect(out.keys, ['1']);
      expect(out['1'], isA<Map<String, dynamic>>());
    });

    test('casts nested lists of maps without wrapping a top-level list', () {
      final out = deepCastJsonMap(<dynamic, dynamic>{
        'rows': <dynamic>[
          <dynamic, dynamic>{'YEAR': 2026},
          12,
          null,
        ],
      });
      expect(out['rows'], isA<List>());
      final rows = out['rows'] as List<dynamic>;
      expect(rows[0], isA<Map<String, dynamic>>());
      expect(rows[1], 12);
      expect(rows[2], isNull);
    });
  });
}
