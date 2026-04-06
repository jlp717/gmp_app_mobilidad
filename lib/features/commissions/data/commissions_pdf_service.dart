import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Commissions PDF Service - DIEGO ONLY
/// Downloads and opens commission PDF reports
class CommissionsPdfService {
  static Future<void> generateAndDownloadPdf({
    required BuildContext context,
    required String vendorCode,
    int? year,
    String? range, // '1', '2', '3', 'all'
    required VoidCallback onLoading,
    required VoidCallback onSuccess,
    required Function(String) onError,
  }) async {
    onLoading();
    try {
      // Build URL with query params
      final uri = Uri.parse(
        '${ApiClient.dio.options.baseUrl}/commissions/pdf',
      ).replace(
        queryParameters: {
          if (vendorCode.isNotEmpty) 'vendorCode': vendorCode,
          if (year != null) 'year': year.toString(),
          if (range != null) 'range': range,
        },
      );

      final response = await http.get(
        uri,
        headers: ApiClient.authHeaders,
      );

      if (response.statusCode == 403) {
        throw Exception('Solo DIEGO puede generar este informe');
      }

      if (response.statusCode != 200) {
        throw Exception('Error al generar PDF: ${response.statusCode}');
      }

      // Save PDF to temp directory
      final tempDir = await getTemporaryDirectory();
      final fileName = 'comisiones_${year ?? DateTime.now().year}_${DateTime.now().millisecondsSinceEpoch}.pdf';
      final filePath = '${tempDir.path}/$fileName';
      final file = File(filePath);
      await file.writeAsBytes(response.bodyBytes);

      // Open PDF
      final result = await OpenFilex.open(filePath);
      if (result.type != ResultType.done) {
        throw Exception('No se pudo abrir el PDF: ${result.message}');
      }

      onSuccess();
    } catch (e) {
      onError(e.toString());
    }
  }
}
