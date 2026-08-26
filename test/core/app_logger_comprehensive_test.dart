// GMP AppLogger Comprehensive Tests
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

enum LogLevel { debug, info, warn, error }

class TestLogger {
  static LogLevel _currentLevel = LogLevel.debug;
  static bool _initialized = false;
  static List<String> _logs = [];

  static void initialize({LogLevel level = LogLevel.debug}) {
    _currentLevel = level;
    _initialized = true;
    _logs = [];
  }

  static void setLevel(LogLevel level) {
    _currentLevel = level;
  }

  static bool shouldLog(LogLevel level) {
    if (!_initialized) {
      _currentLevel = kDebugMode ? LogLevel.debug : LogLevel.warn;
      _initialized = true;
    }
    return level.index >= _currentLevel.index;
  }

  static void debug(String message, {String? tag}) {
    if (shouldLog(LogLevel.debug)) {
      final tagPart = tag != null ? '[$tag] ' : '';
      _logs.add('[DEBUG] $tagPart$message');
    }
  }

  static void info(String message, {String? tag}) {
    if (shouldLog(LogLevel.info)) {
      final tagPart = tag != null ? '[$tag] ' : '';
      _logs.add('[INFO] $tagPart$message');
    }
  }

  static void warn(String message, {String? tag}) {
    if (shouldLog(LogLevel.warn)) {
      final tagPart = tag != null ? '[$tag] ' : '';
      _logs.add('[WARN] $tagPart$message');
    }
  }

  static void error(String message, {String? tag}) {
    if (shouldLog(LogLevel.error)) {
      final tagPart = tag != null ? '[$tag] ' : '';
      _logs.add('[ERROR] $tagPart$message');
    }
  }

  static void http(
    String method,
    String url, {
    int? statusCode,
    int? durationMs,
  }) {
    if (shouldLog(LogLevel.info)) {
      final status = statusCode != null ? '-> $statusCode' : '';
      final duration = durationMs != null ? '(${durationMs}ms)' : '';
      _logs.add('[HTTP] $method $url $status $duration');
    }
  }

  static void clear() {
    _logs = [];
  }

  static List<String> get logs => List.unmodifiable(_logs);
}

void main() {
  group('TestLogger Initialization Tests', () {
    setUp(() {
      TestLogger.initialize(level: LogLevel.debug);
    });

    test('initializes with correct level', () {
      TestLogger.initialize(level: LogLevel.info);
      TestLogger.info('test');
      expect(TestLogger.logs.isNotEmpty, true);
    });

    test('setLevel changes level correctly', () {
      TestLogger.setLevel(LogLevel.warn);
      TestLogger.debug('should not log');
      expect(TestLogger.logs.isEmpty, true);
    });

    test('clear removes all logs', () {
      TestLogger.debug('test');
      expect(TestLogger.logs.isNotEmpty, true);
      TestLogger.clear();
      expect(TestLogger.logs.isEmpty, true);
    });
  });

  group('TestLogger Level Tests', () {
    setUp(() {
      TestLogger.initialize(level: LogLevel.debug);
      TestLogger.clear();
    });

    test('debug logs when level is debug', () {
      TestLogger.setLevel(LogLevel.debug);
      TestLogger.debug('debug message');
      expect(TestLogger.logs.length, 1);
      expect(TestLogger.logs.first, contains('debug message'));
    });

    test('info logs when level is info', () {
      TestLogger.setLevel(LogLevel.info);
      TestLogger.info('info message');
      expect(TestLogger.logs.length, 1);
      expect(TestLogger.logs.first, contains('info message'));
    });

    test('warn logs when level is warn', () {
      TestLogger.setLevel(LogLevel.warn);
      TestLogger.warn('warn message');
      expect(TestLogger.logs.length, 1);
    });

    test('error logs when level is error', () {
      TestLogger.setLevel(LogLevel.error);
      TestLogger.error('error message');
      expect(TestLogger.logs.length, 1);
    });

    test('debug does not log when level is info', () {
      TestLogger.setLevel(LogLevel.info);
      TestLogger.debug('should not appear');
      expect(TestLogger.logs.isEmpty, true);
    });
  });

  group('TestLogger Tag Tests', () {
    setUp(() {
      TestLogger.initialize(level: LogLevel.debug);
      TestLogger.clear();
    });

    test('debug with tag formats correctly', () {
      TestLogger.debug('message', tag: 'TEST');
      expect(TestLogger.logs.first, contains('[TEST]'));
    });

    test('info with tag formats correctly', () {
      TestLogger.info('message', tag: 'API');
      expect(TestLogger.logs.first, contains('[API]'));
    });
  });

  group('TestLogger HTTP Tests', () {
    setUp(() {
      TestLogger.initialize(level: LogLevel.debug);
      TestLogger.clear();
    });

    test('http logs method and url', () {
      TestLogger.http('GET', 'https://api.test.com/data');
      expect(TestLogger.logs.first, contains('GET'));
      expect(TestLogger.logs.first, contains('https://api.test.com/data'));
    });

    test('http logs status code when provided', () {
      TestLogger.http('POST', '/api/users', statusCode: 201);
      expect(TestLogger.logs.first, contains('201'));
    });

    test('http logs duration when provided', () {
      TestLogger.http('GET', '/api/data', durationMs: 150);
      expect(TestLogger.logs.first, contains('150ms'));
    });

    test('http logs all components', () {
      TestLogger.http('PUT', '/api/update', statusCode: 200, durationMs: 75);
      final log = TestLogger.logs.first;
      expect(log, contains('PUT'));
      expect(log, contains('/api/update'));
      expect(log, contains('200'));
      expect(log, contains('75ms'));
    });
  });
}
