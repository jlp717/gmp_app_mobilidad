import 'dart:io';

import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

/// Shares a PDF into WhatsApp together with its caption.
///
/// `wa.me` links can only carry text, so a document share must never open
/// one. On Android the file and the message go in the same send intent,
/// aimed at the phone the user typed. If WhatsApp is not installed, the
/// system share sheet still receives the PDF and the caption together.
class WhatsAppDocumentShare {
  WhatsAppDocumentShare._();

  static const MethodChannel _channel = MethodChannel('gmp/whatsapp_document');

  /// Digits for a WhatsApp JID. A 9-digit Spanish number gets the 34 prefix.
  static String phoneDigits(String phone) {
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 9) return '34$digits';
    return digits;
  }

  /// Opens WhatsApp with [message] as the caption of the PDF at [filePath].
  static Future<void> sharePdf({
    required String filePath,
    required String phone,
    required String message,
    Rect? sharePositionOrigin,
  }) async {
    final file = File(filePath);
    if (!file.existsSync() || file.lengthSync() == 0) {
      throw const WhatsAppDocumentShareException(
        'No se pudo preparar el PDF para WhatsApp.',
      );
    }

    if (Platform.isAndroid) {
      final opened = await _channel.invokeMethod<bool>('sharePdf', {
        'path': file.path,
        'phone': phoneDigits(phone),
        'text': message,
      });
      if (opened ?? false) return;
      throw const WhatsAppDocumentShareException(
        'No se pudo abrir WhatsApp con el PDF. Comprueba que WhatsApp está instalado.',
      );
    }

    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/pdf')],
      text: message,
      subject: message,
      sharePositionOrigin: sharePositionOrigin,
    );
  }

  /// Opens Gmail with the PDF already attached to [email].
  static Future<void> sharePdfByGmail({
    required String filePath,
    required String email,
    required String subject,
    required String message,
    Rect? sharePositionOrigin,
  }) async {
    final file = File(filePath);
    if (!file.existsSync() || file.lengthSync() == 0) {
      throw const WhatsAppDocumentShareException(
        'No se pudo preparar el PDF para el correo.',
      );
    }
    if (Platform.isAndroid) {
      final opened = await _channel.invokeMethod<bool>('shareGmail', {
        'path': file.path,
        'email': email.trim(),
        'subject': subject,
        'text': message,
      });
      if (opened ?? false) return;
    }
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/pdf')],
      text: message,
      subject: subject,
      sharePositionOrigin: sharePositionOrigin,
    );
  }
}

/// Thrown when the PDF file is missing before a WhatsApp document share.
class WhatsAppDocumentShareException implements Exception {
  /// Creates a share failure with a user-facing [message].
  const WhatsAppDocumentShareException(this.message);

  /// Why the share could not start.
  final String message;

  @override
  String toString() => message;
}
