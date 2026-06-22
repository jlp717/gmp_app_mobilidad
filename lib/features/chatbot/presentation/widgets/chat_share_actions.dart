import 'dart:io';

import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// CSV generation and share actions for Asistente GMP chat messages.
class ChatShareActions {
  ChatShareActions._();

  static String buildCsv(ChatExportableData data) {
    final buffer = StringBuffer();
    buffer.writeln(_csvLine(data.headers));
    for (final row in data.rows) {
      buffer.writeln(_csvLine(row));
    }
    return buffer.toString();
  }

  static String _csvLine(List<String> cells) {
    return cells.map(_escapeCsvCell).join(';');
  }

  static String _escapeCsvCell(String cell) {
    if (cell.contains(';') || cell.contains('"') || cell.contains('\n')) {
      return '"${cell.replaceAll('"', '""')}"';
    }
    return cell;
  }

  static Future<File> writeCsvToTemp(ChatExportableData data) async {
    final dir = await getTemporaryDirectory();
    final safeName = data.filename.replaceAll(RegExp(r'[^\w\-.]'), '_');
    final file = File('${dir.path}/$safeName');
    await file.writeAsString(buildCsv(data), flush: true);
    return file;
  }

  static Future<void> exportAndShareCsv(ChatExportableData data) async {
    final file = await writeCsvToTemp(data);
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'text/csv', name: data.filename)],
      subject: 'Asistente GMP — ${data.filename}',
      text: 'Datos exportados desde Asistente GMP',
    );
  }

  static Future<void> shareTextSummary({
    required String summary,
    ChatExportableData? exportable,
  }) async {
    var text = summary;
    if (exportable != null) {
      text =
          '$summary\n\n(Tabla con ${exportable.rows.length} filas — usa Exportar CSV para el archivo completo)';
    }
    await Share.share(text, subject: 'Asistente GMP');
  }

  static Future<void> shareViaWhatsApp(String summary) async {
    final encoded = Uri.encodeComponent(
      'Asistente GMP\n\n$summary',
    );
    final uri = Uri.parse('https://wa.me/?text=$encoded');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  static Future<void> shareViaEmail(String summary, {String? subject}) async {
    final uri = Uri(
      scheme: 'mailto',
      queryParameters: {
        'subject': subject ?? 'Consulta Asistente GMP',
        'body': summary,
      },
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  static Future<void> copyToClipboard(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
  }
}
