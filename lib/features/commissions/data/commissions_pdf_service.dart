import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/commissions/data/pdf_error_parser.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

/// Commissions PDF Service - DIEGO ONLY
/// Downloads and opens commission PDF reports with robust error handling
class CommissionsPdfService {
  // PDF generation is DB2-heavy; backend single-flight coordinates duplicates.
  static const int _maxRetries = 0;
  static const Duration _retryDelay = Duration(seconds: 1);
  static const Duration _openPdfTimeout = Duration(seconds: 12);

  /// Downloads the commissions PDF and opens it with the platform handler.
  static Future<void> generateAndDownloadPdf({
    required String vendorCode,
    required VoidCallback onLoading,
    required VoidCallback onSuccess,
    required Function(String) onError,
    int? year,
    String? range, // '1', '2', '3', 'all' (deprecated)
    String? months, // '1,2,3' (new multi-month selector)
    String pdfType = 'commissions', // commissions | payment_record
  }) async {
    onLoading();

    var attempts = 0;
    Exception? lastError;

    while (attempts <= _maxRetries) {
      try {
        if (attempts > 0) {
          debugPrint('[CommissionsPDF] Retry attempt $attempts/$_maxRetries');
          await Future.delayed(_retryDelay * attempts);
        }

        await _downloadAndOpenPdf(
          vendorCode: vendorCode,
          year: year,
          range: range,
          months: months,
          pdfType: pdfType,
          onSuccess: onSuccess,
          onError: onError,
        );
        return; // Success, exit retry loop
      } catch (e) {
        lastError = e is Exception ? e : Exception(e.toString());
        attempts++;

        debugPrint('[CommissionsPDF] Attempt $attempts failed: $e');

        // Don't retry on 403 (authorization errors)
        if (e.toString().contains('Solo DIEGO puede generar')) {
          onError(e.toString());
          return;
        }
      }
    }

    // All retries failed
    onError(lastError?.toString() ?? 'Error desconocido al generar PDF');
  }

  static Future<void> _downloadAndOpenPdf({
    required String vendorCode,
    required VoidCallback onSuccess,
    required Function(String) onError,
    int? year,
    String? range,
    String? months,
    String pdfType = 'commissions',
  }) async {
    try {
      // Build URL with query params
      final uri = Uri.parse(
        '${ApiClient.dio.options.baseUrl}/commissions/pdf',
      ).replace(
        queryParameters: {
          if (vendorCode.isNotEmpty) 'vendorCode': vendorCode,
          if (year != null) 'year': year.toString(),
          if (months != null) 'months': months, // New: comma-separated months
          if (range != null && months == null)
            'range': range, // Fallback for old API
          'pdfType': pdfType,
          'forceRefresh': '1',
        },
      );

      debugPrint('[CommissionsPDF] Requesting: $uri');

      final response = await ApiClient.dio.get<Uint8List>(
        uri.toString(),
        options: Options(
          responseType: ResponseType.bytes,
          followRedirects: true,
          receiveTimeout:
              const Duration(seconds: 180), // PDF generation can be slow
        ),
      );

      if (response.statusCode == 403) {
        throw Exception('Solo DIEGO puede generar este informe');
      }

      if (response.statusCode != 200) {
        final serverError = extractServerErrorMessage(response.data);
        final errorMsg = serverError.isNotEmpty
            ? serverError
            : 'HTTP ${response.statusCode ?? "desconocido"}';
        throw Exception('Error al generar PDF: $errorMsg');
      }

      // Validate response data
      final pdfBytes = response.data;
      if (pdfBytes == null || pdfBytes.isEmpty) {
        throw Exception('El PDF está vacío o corrupto');
      }

      // Verify PDF magic number (%PDF)
      if (pdfBytes.length < 4 ||
          pdfBytes[0] != 0x25 || // %
          pdfBytes[1] != 0x50 || // P
          pdfBytes[2] != 0x44 || // D
          pdfBytes[3] != 0x46) {
        // F
        throw Exception('El archivo descargado no es un PDF válido');
      }

      // Save PDF to temp directory with unique filename
      final tempDir = await getTemporaryDirectory();
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final fileName = pdfType == 'payment_record'
          ? 'registro_pagos_${year ?? DateTime.now().year}_$timestamp.pdf'
          : 'comisiones_${year ?? DateTime.now().year}_$timestamp.pdf';
      final filePath = '${tempDir.path}/$fileName';
      final file = File(filePath);

      await file.writeAsBytes(pdfBytes);

      // Verify file was written successfully
      if (!await file.exists() || await file.length() == 0) {
        throw Exception('Error guardando el archivo PDF');
      }

      debugPrint(
        '[CommissionsPDF] PDF saved to: $filePath '
        '(${(pdfBytes.length / 1024).toStringAsFixed(2)} KB)',
      );

      // Open PDF with error handling. Some Android file handlers can hang here,
      // so timeout avoids leaving the dialog spinner active after download.
      final result = await OpenFilex.open(filePath).timeout(_openPdfTimeout);
      if (result.type != ResultType.done) {
        debugPrint('[CommissionsPDF] Failed to open PDF: ${result.message}');
        throw Exception('No se pudo abrir el PDF: ${result.message}');
      }

      onSuccess();
    } on TimeoutException {
      debugPrint('[CommissionsPDF] PDF open handler timed out');
      onSuccess();
    } on DioException catch (e) {
      // Handle Dio-specific errors
      if (e.type == DioExceptionType.connectionTimeout) {
        throw Exception(
          'Tiempo de conexión agotado. Verifica tu conexión a internet',
        );
      } else if (e.type == DioExceptionType.receiveTimeout) {
        throw Exception(
          'Tiempo de respuesta agotado. El servidor tardó demasiado',
        );
      } else if (e.type == DioExceptionType.badResponse) {
        if (e.response?.statusCode == 403) {
          throw Exception('Solo DIEGO puede generar este informe');
        }
        final details = extractServerErrorMessage(e.response?.data);
        if (details.isNotEmpty) {
          throw Exception('Error del servidor: $details');
        }
        throw Exception(
          'Error del servidor: ${e.response?.statusCode ?? "desconocido"}',
        );
      } else if (e.type == DioExceptionType.connectionError) {
        throw Exception(
          'No se puede conectar al servidor. Verifica tu conexión',
        );
      }
      throw Exception('Error de red: ${e.message ?? "Error desconocido"}');
    } on SocketException {
      throw Exception('Sin conexión a internet. Verifica tu red');
    } catch (e) {
      // Re-throw if it's already an Exception with our custom messages
      if (e is Exception) {
        rethrow;
      }
      throw Exception('Error inesperado: $e');
    }
  }
}
