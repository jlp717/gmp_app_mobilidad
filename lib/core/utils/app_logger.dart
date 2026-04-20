import 'package:flutter/foundation.dart';

enum LogLevel {
  debug,
  info,
  warn,
  error,
}

class AppLogger {
  static LogLevel _currentLevel = LogLevel.debug;

  static bool _initialized = false;

  static void initialize({LogLevel level = LogLevel.debug}) {
    _currentLevel = level;
    _initialized = true;
  }

  static void setLevel(LogLevel level) {
    _currentLevel = level;
  }

  static bool _shouldLog(LogLevel level) {
    if (!_initialized) {
      _currentLevel = kDebugMode ? LogLevel.debug : LogLevel.warn;
      _initialized = true;
    }
    return level.index >= _currentLevel.index;
  }

  static void debug(String message, {String? tag, Object? data}) {
    if (_shouldLog(LogLevel.debug)) {
      final prefix = tag != null ? '[$tag] ' : '';
      debugPrint('$prefix$message');
      if (data != null) {
        debugPrint('Data: $data');
      }
    }
  }

  static void info(String message, {String? tag, Object? data}) {
    if (_shouldLog(LogLevel.info)) {
      final prefix = tag != null ? '[$tag] ' : '';
      debugPrint('$prefix$message');
      if (data != null) {
        debugPrint('Data: $data');
      }
    }
  }

  static void warn(String message, {String? tag, Object? data}) {
    if (_shouldLog(LogLevel.warn)) {
      final prefix = tag != null ? '[$tag] ' : '';
      debugPrint('$prefix$message');
      if (data != null) {
        debugPrint('Data: $data');
      }
    }
  }

  static void error(String message,
      {String? tag, Object? error, StackTrace? stackTrace,}) {
    if (_shouldLog(LogLevel.error)) {
      final prefix = tag != null ? '[$tag] ' : '';
      debugPrint('$prefix$message');
      if (error != null) {
        debugPrint('Error: $error');
      }
      if (stackTrace != null) {
        debugPrint('StackTrace: $stackTrace');
      }
    }
  }

  static void http(String method, String url,
      {int? statusCode, int? durationMs,}) {
    if (_shouldLog(LogLevel.info)) {
      debugPrint(
          '[HTTP] $method $url ${statusCode != null ? '-> $statusCode' : ''} ${durationMs != null ? '(${durationMs}ms)' : ''}',);
    }
  }
}
