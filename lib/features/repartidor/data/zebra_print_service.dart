import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_bluetooth_printer/flutter_bluetooth_printer.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/thermal_ticket_layout.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

export 'package:gmp_app_mobilidad/features/repartidor/data/thermal_ticket_layout.dart'
    show ThermalTicketLayout, ZplGraphic;

enum PrinterFailureCode {
  noAddress,
  permissionsDenied,
  bluetoothOff,
  timeout,
  payloadTooLarge,
  missingPayload,
  sendFailed,
}

class PrinterJobResult {
  const PrinterJobResult.success()
      : ok = true,
        failure = null;

  const PrinterJobResult.fail(this.failure) : ok = false;

  final bool ok;
  final PrinterFailureCode? failure;

  String get message {
    switch (failure) {
      case PrinterFailureCode.noAddress:
        return 'No hay impresora seleccionada. Elige una en Bluetooth.';
      case PrinterFailureCode.permissionsDenied:
        return 'Faltan permisos de Bluetooth. Actívalos en Ajustes.';
      case PrinterFailureCode.bluetoothOff:
        return 'Bluetooth está apagado. Enciéndelo e inténtalo de nuevo.';
      case PrinterFailureCode.timeout:
        return 'La impresora no responde. Comprueba que está encendida, cerca y vinculada.';
      case PrinterFailureCode.payloadTooLarge:
        return 'El ticket es demasiado grande para la impresora.';
      case PrinterFailureCode.missingPayload:
        return 'No se pudo generar el ticket.';
      case PrinterFailureCode.sendFailed:
        return 'No se pudo enviar el ticket. Comprueba que está encendida '
            'y, si no sale papel, pulsa Cambiar y elige ZPL (Zebra) o '
            'ESC/POS (genérica).';
      case null:
        return 'Ticket enviado a la impresora.';
    }
  }
}

/// Bluetooth ticket printer for repartidor deliveries.
///
/// Transport is model-agnostic: any paired Bluetooth SPP printer can be
/// selected. Payload is ZPL or ESC/POS based on the saved protocol
/// (`zpl` | `escpos`). Zebra/ZPL printers use raw ZPL; generic BT printers
/// use ESC/POS text. Changing device = pick in the BT picker + set protocol.
class ZebraPrintService {
  // NOTE: Printer MAC addresses stored in SharedPreferences are low-risk
  // (they are public identifiers, not secrets), but should migrate to
  // flutter_secure_storage if the threat model changes.
  static const String _prefKey = 'repartidor_tiene_impresora';
  static const String _prefAddress = 'repartidor_printer_address';
  static const String _prefName = 'repartidor_printer_name';
  static const String _prefProtocol = 'repartidor_printer_protocol';

  // -- Printer configuration persistence --

  static Future<bool> tieneImpresora() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefKey) ?? false;
  }

  static Future<void> setTieneImpresora(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKey, value);
  }

  static Future<String?> getSavedPrinterAddress() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefAddress);
  }

  static Future<String?> getSavedPrinterName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefName);
  }

  /// Saved print protocol: `zpl` (default) or `escpos`.
  static Future<String> getPrinterProtocol() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_prefProtocol);
    return value == 'escpos' ? 'escpos' : 'zpl';
  }

  static Future<void> setPrinterProtocol(String protocol) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _prefProtocol,
      protocol == 'escpos' ? 'escpos' : 'zpl',
    );
  }

  static Future<void> savePrinter(
    String address,
    String name, {
    String protocol = 'zpl',
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefAddress, address);
    await prefs.setString(_prefName, name);
    await prefs.setString(
      _prefProtocol,
      protocol == 'escpos' ? 'escpos' : 'zpl',
    );
    // Seed paper width from model name when user has not overridden it.
    if (!prefs.containsKey(_prefPaperWidthMm)) {
      await prefs.setInt(
        _prefPaperWidthMm,
        ThermalTicketLayout.inferWidthMm(name),
      );
    }
  }

  // -- Bluetooth permissions --

  /// Android 12+ can print to a known MAC with CONNECT (SCAN for picker).
  /// Location is not required: `BLUETOOTH_SCAN` uses `neverForLocation`.
  static Future<bool> requestBluetoothPermissions() async {
    final connectStatus = await Permission.bluetoothConnect.status;
    final scanStatus = await Permission.bluetoothScan.status;
    if (_isGranted(connectStatus) && _isGranted(scanStatus)) {
      return true;
    }

    final statuses = await [
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
    ].request();
    final connect = statuses[Permission.bluetoothConnect] ?? connectStatus;
    final scan = statuses[Permission.bluetoothScan] ?? scanStatus;
    if (_isGranted(connect) && _isGranted(scan)) return true;

    // Print to a saved address only needs CONNECT on Android 12+.
    if (_isGranted(connect)) return true;

    final bluetooth = await Permission.bluetooth.request();
    if (_isGranted(bluetooth)) return true;

    debugPrint('[ZEBRA] BT permissions not granted');
    return false;
  }

  static bool _isGranted(PermissionStatus status) =>
      status.isGranted || status.isLimited;

  // -- Bluetooth state --

  /// Check if Bluetooth adapter is enabled.
  /// Unknown / plugin errors do not block printing; only a real disabled adapter does.
  static Future<bool> isBluetoothEnabled() async {
    try {
      final state = await FlutterBluetoothPrinter.getState().timeout(
        const Duration(seconds: 4),
        onTimeout: () => BluetoothState.unknown,
      );
      if (state == BluetoothState.disabled) return false;
      return state != BluetoothState.notPermitted;
    } catch (_) {
      return true;
    }
  }

  /// Returns a hard blocker, or null when printing should still be attempted.
  static Future<PrinterFailureCode?> _bluetoothBlocker() async {
    try {
      final state = await FlutterBluetoothPrinter.getState().timeout(
        const Duration(seconds: 4),
        onTimeout: () => BluetoothState.unknown,
      );
      if (state == BluetoothState.disabled) {
        return PrinterFailureCode.bluetoothOff;
      }
      if (state == BluetoothState.notPermitted) {
        return PrinterFailureCode.permissionsDenied;
      }
    } catch (e) {
      debugPrint('[ZEBRA] getState skipped, trying print anyway: $e');
    }
    return null;
  }

  static Future<void> _safeDisconnect(String address) async {
    try {
      await FlutterBluetoothPrinter.disconnect(address)
          .timeout(const Duration(seconds: 2));
    } catch (_) {}
  }

  /// Test connection to the saved (or given) printer.
  /// Returns true if the printer is reachable via BT.
  /// Includes a hard timeout so the rutero sheet cannot freeze.
  static Future<bool> testConnection({String? address}) async {
    String? addr;
    try {
      addr = address ?? await getSavedPrinterAddress();
      if (addr == null || addr.isEmpty) return false;

      final granted = await requestBluetoothPermissions();
      if (!granted) return false;

      return await FlutterBluetoothPrinter.connect(addr)
          .timeout(const Duration(seconds: 10), onTimeout: () => false);
    } catch (_) {
      debugPrint('[ZEBRA] Connection test failed');
      return false;
    } finally {
      if (addr != null && addr.isNotEmpty) {
        await _safeDisconnect(addr);
      }
    }
  }

  /// Global connection state notifier from the BT library.
  static ValueNotifier<BluetoothConnectionState> get connectionStateNotifier =>
      FlutterBluetoothPrinter.connectionStateNotifier;

  /// Mask a BT address for display: "AA:BB:CC:DD:EE:FF" → "AA:BB:··:··:EE:FF"
  static String maskAddress(String address) {
    final parts = address.split(':');
    if (parts.length != 6) return '···';
    return '${parts[0]}:${parts[1]}:··:··:${parts[4]}:${parts[5]}';
  }

  // -- Device selection (uses built-in picker) --

  /// Shows the built-in Bluetooth device picker.
  /// Returns the selected device, or null if cancelled.
  static Future<BluetoothDevice?> selectPrinter(
    BuildContext context,
  ) async {
    final granted = await requestBluetoothPermissions();
    if (!granted) return null;
    return FlutterBluetoothPrinter.selectDevice(context);
  }

  /// Clear saved printer data.
  static Future<void> clearPrinter() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefAddress);
    await prefs.remove(_prefName);
  }

  // -- ZPL generation --

  static const String _prefPaperWidthMm = 'repartidor_printer_paper_width_mm';
  static const String _logoAssetPath = 'assets/branding/ticket_header.png';
  static ZplGraphic? _cachedLogoGrf;
  static int? _cachedLogoMaxWidth;

  /// Convert PNG signature bytes to ZPL GRF (`^GFA,...`) or null on failure.
  static Future<String?> convertSignatureToGrf(
    Uint8List pngBytes, {
    int maxWidth = 300,
    int maxHeight = 100,
  }) async {
    final graphic = await convertPngToGrf(
      pngBytes,
      maxWidth: maxWidth,
      maxHeight: maxHeight,
    );
    return graphic?.command;
  }

  /// Convert PNG to monochrome ZPL graphic with measured size (centering).
  static Future<ZplGraphic?> convertPngToGrf(
    Uint8List pngBytes, {
    int maxWidth = 300,
    int maxHeight = 100,
    int blackThreshold = 160,
  }) async {
    try {
      return await () async {
        // Decode by width only — never force both axes (distorts banner).
        final codec = await ui.instantiateImageCodec(
          pngBytes,
          targetWidth: maxWidth,
        );
        final frame = await codec.getNextFrame();
        final image = frame.image;

        final byteData = await image.toByteData();
        if (byteData == null) return null;

        final pixels = byteData.buffer.asUint8List();
        final srcW = image.width;
        final srcH = image.height;

        final scaleX = srcW > maxWidth ? maxWidth / srcW : 1.0;
        final scaleY = srcH > maxHeight ? maxHeight / srcH : 1.0;
        final scale = scaleX < scaleY ? scaleX : scaleY;
        final outW = (srcW * scale).round().clamp(1, maxWidth);
        final outH = (srcH * scale).round().clamp(1, maxHeight);

        final bytesPerRow = (outW + 7) ~/ 8;
        final totalBytes = bytesPerRow * outH;
        final hex = StringBuffer();

        for (var row = 0; row < outH; row++) {
          for (var col = 0; col < bytesPerRow; col++) {
            var byte = 0;
            for (var bit = 0; bit < 8; bit++) {
              final x = col * 8 + bit;
              if (x < outW) {
                final srcX = (x / scale).round().clamp(0, srcW - 1);
                final srcY = (row / scale).round().clamp(0, srcH - 1);
                final pixelIdx = (srcY * srcW + srcX) * 4;
                final r = pixels[pixelIdx];
                final g = pixels[pixelIdx + 1];
                final b = pixels[pixelIdx + 2];
                final a = pixels[pixelIdx + 3];
                if (a < 32) continue;
                if ((r * 299 + g * 587 + b * 114) ~/ 1000 < blackThreshold) {
                  byte |= 0x80 >> bit;
                }
              }
            }
            hex.write(byte.toRadixString(16).padLeft(2, '0').toUpperCase());
          }
        }

        return ZplGraphic(
          command: '^GFA,$totalBytes,$totalBytes,$bytesPerRow,$hex',
          widthDots: outW,
          heightDots: outH,
        );
      }()
          .timeout(const Duration(seconds: 6));
    } catch (_) {
      debugPrint('[ZEBRA] GRF conversion failed or timed out');
      return null;
    }
  }

  /// Paper width mm (58|80). Pref override, else infer from printer name.
  static Future<int> getPaperWidthMm({String? printerName}) async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt(_prefPaperWidthMm);
    if (saved == 58 || saved == 80) return saved!;
    return ThermalTicketLayout.inferWidthMm(
      printerName ?? await getSavedPrinterName(),
    );
  }

  static Future<void> setPaperWidthMm(int widthMm) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_prefPaperWidthMm, widthMm <= 58 ? 58 : 80);
  }

  /// Resolve adaptive layout for current / given printer.
  static Future<ThermalTicketLayout> resolveLayout({
    String? printerName,
    int? widthMm,
  }) async {
    final mm = widthMm ?? await getPaperWidthMm(printerName: printerName);
    return ThermalTicketLayout.forPrinter(
      printerName: printerName ?? await getSavedPrinterName(),
      widthMmOverride: mm,
    );
  }

  /// Company header art (same PNG as factura/albarán PDF).
  static Future<ZplGraphic?> loadCompanyLogoGrf({
    required int maxWidth,
    int maxHeight = 88,
  }) async {
    final cacheKey = maxWidth * 1000 + maxHeight;
    if (_cachedLogoGrf != null && _cachedLogoMaxWidth == cacheKey) {
      return _cachedLogoGrf;
    }
    try {
      final data = await rootBundle.load(_logoAssetPath);
      final graphic = await convertPngToGrf(
        data.buffer.asUint8List(),
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        blackThreshold: 180,
      );
      _cachedLogoGrf = graphic;
      _cachedLogoMaxWidth = cacheKey;
      return graphic;
    } catch (e) {
      debugPrint('[ZEBRA] Logo asset missing ($_logoAssetPath): $e');
      return null;
    }
  }

  static void _writeZplPreamble(StringBuffer buf, ThermalTicketLayout layout) {
    buf.writeln('^XA');
    buf.writeln('^CI28');
    // Continuous media + tear-off; origin at top-left of printable area.
    buf.writeln('^MNN');
    buf.writeln('^MMT');
    buf.writeln('^MFN,N');
    buf.writeln('^LH0,0');
    buf.writeln('^LT0');
    buf.writeln('^LS0');
    buf.writeln('^PON');
    buf.writeln('^PW${layout.printWidthDots}');
  }

  static void _writeCentered(
    StringBuffer buf,
    ThermalTicketLayout layout,
    int y,
    int font,
    String text,
  ) {
    final safe = _sanitizeZpl(text);
    final maxChars = layout.charsFor(font);
    final clipped = _truncate(safe, maxChars);
    final textW = clipped.length * layout.charDots(font);
    final x = layout.centerX(textW);
    buf.writeln('^CF0,$font');
    buf.writeln('^FO$x,$y^FD$clipped^FS');
  }

  static void _writeLeft(
    StringBuffer buf,
    ThermalTicketLayout layout,
    int y,
    int font,
    String text, {
    int? x,
    int? maxChars,
  }) {
    final safe = _sanitizeZpl(text);
    final startX = x ?? layout.xLeft;
    final budget = maxChars ?? layout.charsBetween(startX, layout.xRight, font);
    final clipped = _truncate(safe, budget);
    final textW = clipped.length * layout.charDots(font);
    final fo = layout.clampX(startX, textW);
    buf.writeln('^CF0,$font');
    buf.writeln('^FO$fo,$y^FD$clipped^FS');
  }

  static void _writeSep(
    StringBuffer buf,
    ThermalTicketLayout layout,
    int y, {
    int thickness = 1,
  }) {
    buf.writeln(
      '^FO${layout.xLeft},$y^GB${layout.lineW},$thickness,$thickness^FS',
    );
  }

  /// Strip leading numeric vendor code from name (e.g., "08 DAMIAN" → "DAMIAN")
  static String _stripCodePrefix(String name) {
    return name.replaceFirst(RegExp(r'^\d+\s+'), '').trim();
  }

  /// Escape ZPL special characters in field data to prevent ZPL injection.
  static String _sanitizeZpl(String text) {
    return text
        .replaceAll('^', '_^')
        .replaceAll('~', '_~')
        .replaceAll('\x00', '')
        .replaceAll('\x1B', '');
  }

  /// Maximum ZPL payload size in bytes to prevent printer DoS.
  static const int _maxZplPayloadBytes = 65536;

  static String generateDeliveryZpl({
    required AlbaranEntrega albaran,
    required List<EntregaItem> items,
    required String observaciones,
    String? receptorNombre,
    String? receptorDni,
    String? signatureGrf,
    DateTime? fechaFirma,
    ThermalTicketLayout? layout,
    ZplGraphic? logoGrf,
  }) {
    final L = layout ?? const ThermalTicketLayout(widthMm: 80);
    final buf = StringBuffer();
    var y = L.yStart;

    _writeZplPreamble(buf, L);

    // ═══ LOGO — top of printable area, centered inside side margins ═══
    if (logoGrf != null) {
      final lx = L.centerX(logoGrf.widthDots);
      // Machine-readable size for geometry audits (Zebra ignores ^FX).
      buf.writeln('^FXlogo,${logoGrf.widthDots},${logoGrf.heightDots}');
      buf.writeln('^FO$lx,$y${logoGrf.command}^FS');
      y += logoGrf.heightDots + 8;
    } else {
      // Fallback text header only when banner asset missing.
      final fTitle = L.fontSize(28);
      final fMeta = L.fontSize(15);
      _writeCentered(buf, L, y, fTitle, 'GRANJA MARI PEPA S.L.');
      y += L.rowGap(fTitle);
      _writeCentered(buf, L, y, fMeta, 'Pol. Ind. Saprelorca - Parcela D3');
      y += L.rowGap(fMeta) - 2;
      _writeCentered(buf, L, y, fMeta, '30817 Lorca (Murcia)');
      y += L.rowGap(fMeta) - 2;
      _writeCentered(buf, L, y, fMeta, 'CIF: B04008710  Tel: 968 47 08 80');
      y += L.rowGap(fMeta);
    }

    final fBody = L.fontSize(16);
    final fMeta = L.fontSize(15);

    _writeSep(buf, L, y, thickness: 2);
    y += 8;
    _writeSep(buf, L, y, thickness: 1);
    y += 12;

    // ═══ DOCUMENT TYPE + NUMBER ═══
    final isFactura = albaran.numeroFactura > 0;
    final docType = isFactura ? 'FACTURA' : 'ALBARAN';
    final docNum = isFactura
        ? '${albaran.serieFactura}-${albaran.terminal}-${albaran.numeroFactura}'
        : '${albaran.serie}-${albaran.terminal}-${albaran.numeroAlbaran}';
    final fDoc = L.fontSize(26);
    _writeLeft(buf, L, y, fDoc, '$docType: $docNum');
    y += L.rowGap(fDoc);
    _writeLeft(buf, L, y, fBody, 'Fecha: ${albaran.fecha}');
    y += L.rowGap(fBody);
    if (albaran.ordenPreparacion != null) {
      _writeLeft(
        buf,
        L,
        y,
        fBody,
        'Orden Prep.: ${albaran.ordenPreparacion!}',
      );
      y += L.rowGap(fBody);
    }

    // ═══ CLIENT INFO ═══
    final fClient = L.fontSize(18);
    _writeLeft(buf, L, y, fClient, 'Cliente: ${albaran.codigoCliente}');
    y += L.rowGap(fClient);
    _writeLeft(buf, L, y, fBody, albaran.nombreCliente);
    y += L.rowGap(fBody);
    if (albaran.direccion.isNotEmpty) {
      for (final line in _wrapText(
        _sanitizeZpl(albaran.direccion),
        L.charsFor(fMeta),
      )) {
        _writeLeft(buf, L, y, fMeta, line);
        y += L.rowGap(fMeta) - 2;
      }
    }
    _writeLeft(buf, L, y, fMeta, 'Forma de pago: ${albaran.formaPagoDesc}');
    y += L.rowGap(fMeta) + 2;

    _writeSep(buf, L, y);
    y += 10;

    // ═══ PRODUCT TABLE HEADER ═══
    final descMax = L.charsBetween(L.colDesc, L.colBult - 4, fMeta);
    buf.writeln('^CF0,$fMeta');
    buf.writeln('^FO${L.colPtda},$y^FDPtda^FS');
    buf.writeln('^FO${L.colDesc},$y^FDArticulo / Descripcion^FS');
    buf.writeln('^FO${L.colBult},$y^FDBult^FS');
    buf.writeln('^FO${L.colImp},$y^FDImporte^FS');
    y += L.rowGap(fMeta);
    _writeSep(buf, L, y);
    y += 8;

    // ═══ PRODUCT LINES ═══
    var totalBultos = 0.0;
    final descChars = L.charsBetween(L.colDesc, L.colBult - 4, fBody);
    for (var i = 0; i < items.length; i++) {
      final item = items[i];
      final partida = '${i + 1}';
      final bultos = item.bultos > 0 ? item.bultos : item.cantidadPedida;
      totalBultos += bultos;
      final importe = item.cantidadPedida * item.precioUnitario;

      buf.writeln('^CF0,$fBody');
      buf.writeln('^FO${L.colPtda},$y^FD$partida^FS');
      if (item.codigoArticulo.isNotEmpty) {
        _writeLeft(
          buf,
          L,
          y,
          fMeta,
          item.codigoArticulo,
          x: L.colDesc,
          maxChars: descChars,
        );
      }
      buf.writeln('^CF0,$fBody');
      buf.writeln(
        '^FO${L.colBult},$y^FD${_formatQuantity(bultos)}^FS',
      );
      buf.writeln(
        '^FO${L.colImp},$y^FD${importe.toStringAsFixed(2)}^FS',
      );
      y += L.rowGap(fBody);

      _writeLeft(
        buf,
        L,
        y,
        fBody,
        item.descripcion,
        x: L.colDesc,
        maxChars: descChars + (descMax > descChars ? 2 : 0),
      );
      y += L.rowGap(fBody) + 2;
    }

    // ═══ TOTALS ═══
    y += 2;
    _writeSep(buf, L, y, thickness: 2);
    y += 12;

    _writeLeft(
      buf,
      L,
      y,
      fBody,
      'Bultos: ${_formatQuantity(totalBultos)}',
      x: L.totalsAnchor,
    );
    y += L.rowGap(fBody);

    if (albaran.importeNeto > 0) {
      _writeLeft(
        buf,
        L,
        y,
        fBody,
        'Importe Neto: ${albaran.importeNeto.toStringAsFixed(2)} EUR',
        x: L.totalsAnchor,
      );
      y += L.rowGap(fBody);
    }

    if (albaran.ivaBreakdown.isNotEmpty) {
      for (final iva in albaran.ivaBreakdown) {
        _writeLeft(
          buf,
          L,
          y,
          fMeta,
          'IVA ${iva.pct.toStringAsFixed(0)}%: ${iva.iva.toStringAsFixed(2)} EUR',
          x: L.totalsAnchor,
        );
        y += L.rowGap(fMeta);
      }
    }

    y += 4;
    _writeSep(buf, L, y);
    y += 8;
    final fTotal = L.fontSize(26);
    _writeLeft(
      buf,
      L,
      y,
      fTotal,
      'TOTAL: ${albaran.importeTotal.toStringAsFixed(2)} EUR',
    );
    y += L.rowGap(fTotal);
    _writeSep(buf, L, y);
    y += 12;

    // ═══ SIGNATURE ═══
    if (receptorNombre != null && receptorNombre.isNotEmpty) {
      _writeLeft(buf, L, y, fBody, 'Firmante: $receptorNombre');
      y += L.rowGap(fBody);
      if (receptorDni != null && receptorDni.isNotEmpty) {
        _writeLeft(buf, L, y, fMeta, 'DNI/NIF: $receptorDni');
        y += L.rowGap(fMeta);
      }

      if (signatureGrf != null && signatureGrf.isNotEmpty) {
        final sigW = (L.contentWidth * 0.72).round().clamp(160, L.contentWidth);
        final sx = L.centerX(sigW);
        buf.writeln('^FO$sx,$y$signatureGrf^FS');
        y += 110;
      } else {
        final boxW = (L.contentWidth * 0.55).round();
        buf.writeln('^FO${L.xLeft},$y^GB$boxW,60,1^FS');
        buf.writeln('^CF0,$fMeta');
        buf.writeln('^FO${L.xLeft + 40},${y + 20}^FD[FIRMADO]^FS');
        y += 70;
      }

      if (fechaFirma != null) {
        final ff = '${fechaFirma.day.toString().padLeft(2, '0')}/'
            '${fechaFirma.month.toString().padLeft(2, '0')}/'
            '${fechaFirma.year} '
            '${fechaFirma.hour.toString().padLeft(2, '0')}:'
            '${fechaFirma.minute.toString().padLeft(2, '0')}';
        _writeLeft(buf, L, y, fMeta, 'Fecha firma: $ff');
        y += L.rowGap(fMeta);
      }
    }

    // ═══ OBSERVATIONS ═══
    if (observaciones.isNotEmpty) {
      for (final line
          in _wrapText(_sanitizeZpl(observaciones), L.charsFor(fMeta))) {
        _writeLeft(buf, L, y, fMeta, 'Obs: $line');
        y += L.rowGap(fMeta);
      }
      y += 4;
    }

    // ═══ FOOTER ═══
    _writeSep(buf, L, y);
    y += 10;
    for (final line in _wrapText(
      'La posesion de este documento NO implica el pago de la misma',
      L.charsFor(fMeta),
    )) {
      _writeLeft(buf, L, y, fMeta, line);
      y += L.rowGap(fMeta) - 2;
    }
    for (final line in _wrapText(
      'No se admiten devoluciones una vez aceptada la recepcion',
      L.charsFor(fMeta),
    )) {
      _writeLeft(buf, L, y, fMeta, line);
      y += L.rowGap(fMeta) - 2;
    }
    y += 4;
    final repartidorDisplay = _stripCodePrefix(
      albaran.nombreRepartidor.isNotEmpty
          ? albaran.nombreRepartidor
          : albaran.codigoRepartidor,
    );
    _writeLeft(buf, L, y, fBody, 'Entregado por: $repartidorDisplay');
    y += L.rowGap(fBody);

    // Content height + bottom margin only (no dead paper).
    buf.writeln('^LL${L.labelLength(y)}');
    buf.writeln('^XZ');
    return buf.toString();
  }

  // -- ESC/POS generation --

  static const int _escPosLineWidth = 32;

  /// Simple ESC/POS ticket bytes for generic Bluetooth printers.
  static Uint8List generateEscPosTicket({
    required String clientName,
    required String albaranLabel,
    required List<Map<String, dynamic>> lines,
    required double total,
    String? paymentLabel,
  }) {
    final out = BytesBuilder(copy: false);
    out.add(const [0x1B, 0x40]); // ESC @ initialize

    void writeLine(String text) {
      final line = _truncate(_toAscii(text), _escPosLineWidth);
      out.add(ascii.encode('$line\n'));
    }

    void writeCentered(String text) {
      final clipped = _truncate(_toAscii(text), _escPosLineWidth);
      final pad =
          ((_escPosLineWidth - clipped.length) / 2).floor().clamp(0, 16);
      out.add(ascii.encode('${' ' * pad}$clipped\n'));
    }

    out.add(const [0x1B, 0x61, 0x01]); // center
    writeCentered('GRANJA MARI PEPA S.L.');
    out.add(const [0x1B, 0x61, 0x00]); // left
    writeLine(albaranLabel);
    writeLine(clientName);
    writeLine('-' * _escPosLineWidth);

    for (final line in lines) {
      final desc = (line['desc'] ?? line['descripcion'] ?? '').toString();
      final qty = line['qty'] ?? line['cantidad'];
      final importe = line['importe'] ?? line['amount'];
      if (desc.isNotEmpty) {
        writeLine(desc);
      }
      final parts = <String>[];
      if (qty != null) {
        parts.add(
          'x${_formatQuantity(qty is num ? qty : num.tryParse(qty.toString()) ?? 0)}',
        );
      }
      if (importe != null) {
        final amount = importe is num
            ? importe.toDouble()
            : double.tryParse(importe.toString()) ?? 0;
        parts.add('${amount.toStringAsFixed(2)} EUR');
      }
      if (parts.isNotEmpty) {
        writeLine(parts.join(' '));
      }
    }

    writeLine('-' * _escPosLineWidth);
    writeLine('TOTAL: ${total.toStringAsFixed(2)} EUR');
    if (paymentLabel != null && paymentLabel.isNotEmpty) {
      writeLine(paymentLabel);
    }
    writeLine('');
    writeLine('Gracias');
    writeLine('');
    writeLine('');

    out.add(const [0x1D, 0x56, 0x00]); // GS V 0 full cut
    return out.toBytes();
  }

  /// Compact reprint ticket for history (albaran/factura + optional GRF).
  static String generateHistoryDeliveryZpl({
    required String title,
    required String clientName,
    required String dateLabel,
    required double total,
    String? signatureGrf,
    String? receptorNombre,
    String? receptorApellidos,
    String? receptorDni,
    ThermalTicketLayout? layout,
    ZplGraphic? logoGrf,
  }) {
    final L = layout ?? const ThermalTicketLayout(widthMm: 80);
    final buf = StringBuffer();
    var y = L.yStart;
    _writeZplPreamble(buf, L);

    if (logoGrf != null) {
      final lx = L.centerX(logoGrf.widthDots);
      buf.writeln('^FXlogo,${logoGrf.widthDots},${logoGrf.heightDots}');
      buf.writeln('^FO$lx,$y${logoGrf.command}^FS');
      y += logoGrf.heightDots + 8;
    } else {
      final fTitle = L.fontSize(26);
      _writeCentered(buf, L, y, fTitle, 'GRANJA MARI PEPA S.L.');
      y += L.rowGap(fTitle);
    }

    final fBody = L.fontSize(18);
    final fMeta = L.fontSize(15);
    _writeLeft(buf, L, y, fBody, title);
    y += L.rowGap(fBody);
    _writeLeft(buf, L, y, fMeta, clientName);
    y += L.rowGap(fMeta);
    _writeLeft(buf, L, y, fMeta, 'Fecha: $dateLabel');
    y += L.rowGap(fMeta);
    final fTotal = L.fontSize(24);
    _writeLeft(buf, L, y, fTotal, 'TOTAL: ${total.toStringAsFixed(2)} EUR');
    y += L.rowGap(fTotal);
    final receptorFull = [
      receptorNombre?.trim() ?? '',
      receptorApellidos?.trim() ?? '',
    ].where((part) => part.isNotEmpty).join(' ');
    if (receptorFull.isNotEmpty) {
      _writeLeft(buf, L, y, fMeta, 'Receptor: $receptorFull');
      y += L.rowGap(fMeta);
    }
    final dni = receptorDni?.trim() ?? '';
    if (dni.isNotEmpty) {
      _writeLeft(buf, L, y, fMeta, 'DNI: $dni');
      y += L.rowGap(fMeta);
    }
    if (signatureGrf != null && signatureGrf.isNotEmpty) {
      final sigW = (L.contentWidth * 0.72).round().clamp(160, L.contentWidth);
      buf.writeln('^FO${L.centerX(sigW)},$y$signatureGrf^FS');
      y += 110;
    }
    _writeSep(buf, L, y);
    y += 12;
    _writeLeft(buf, L, y, fMeta, 'Reimpresion nota de entrega');
    y += L.rowGap(fMeta);
    buf.writeln('^LL${L.labelLength(y)}');
    buf.writeln('^XZ');
    return buf.toString();
  }

  // -- Print execution --

  /// Sleeping Zebra RFCOMM connect often exceeds 12s. Aborting mid-write
  /// leaves incomplete ZPL and the printer ejects nothing.
  static const Duration _printAttemptTimeout = Duration(seconds: 28);
  static const Duration _flushAfterPrint = Duration(milliseconds: 500);
  static const Duration _retryPause = Duration(seconds: 2);
  static const Duration _busyClearPause = Duration(seconds: 3);

  static Future<PrinterJobResult> _sendBytes(
    Uint8List bytes, {
    String? address,
  }) async {
    final addr = address ?? await getSavedPrinterAddress();
    if (addr == null || addr.isEmpty) {
      return const PrinterJobResult.fail(PrinterFailureCode.noAddress);
    }

    final granted = await requestBluetoothPermissions();
    if (!granted) {
      return const PrinterJobResult.fail(
        PrinterFailureCode.permissionsDenied,
      );
    }

    final blocker = await _bluetoothBlocker();
    if (blocker != null) {
      return PrinterJobResult.fail(blocker);
    }

    var lastFailure = PrinterFailureCode.sendFailed;
    for (var attempt = 0; attempt < 2; attempt++) {
      var timedOut = false;
      try {
        final ok = await FlutterBluetoothPrinter.printBytes(
          address: addr,
          data: bytes,
          keepConnected: true,
          delayTime: 20,
          maxBufferSize: bytes.length,
        ).timeout(
          _printAttemptTimeout,
          onTimeout: () {
            timedOut = true;
            return false;
          },
        );
        debugPrint(
          '[ZEBRA] Print result ok=$ok timedOut=$timedOut attempt=$attempt',
        );
        if (ok) {
          await Future<void>.delayed(_flushAfterPrint);
          return const PrinterJobResult.success();
        }
        lastFailure = timedOut
            ? PrinterFailureCode.timeout
            : PrinterFailureCode.sendFailed;
      } on TimeoutException {
        timedOut = true;
        lastFailure = PrinterFailureCode.timeout;
      } catch (e) {
        debugPrint('[ZEBRA] Print failed: $e');
        lastFailure = PrinterFailureCode.sendFailed;
      } finally {
        await _safeDisconnect(addr);
      }

      if (attempt == 0) {
        await Future<void>.delayed(
          timedOut ? _busyClearPause : _retryPause,
        );
      }
    }

    return PrinterJobResult.fail(lastFailure);
  }

  /// Sends raw ZPL to the saved (or given) printer.
  static Future<PrinterJobResult> printZpl(
    String zplData, {
    String? address,
  }) async {
    final payloadBytes = utf8.encode(zplData).length;
    if (payloadBytes > _maxZplPayloadBytes) {
      debugPrint(
        '[ZEBRA] ZPL payload too large: $payloadBytes bytes '
        '(max $_maxZplPayloadBytes)',
      );
      return const PrinterJobResult.fail(PrinterFailureCode.payloadTooLarge);
    }
    if (zplData.trim().isEmpty) {
      return const PrinterJobResult.fail(PrinterFailureCode.missingPayload);
    }
    return _sendBytes(
      Uint8List.fromList(utf8.encode(zplData)),
      address: address,
    );
  }

  /// Print ticket using saved protocol (`zpl` | `escpos`).
  static Future<PrinterJobResult> printTicket({
    String? zpl,
    Uint8List? escPosBytes,
    String? address,
  }) async {
    final protocol = await getPrinterProtocol();
    if (protocol == 'escpos') {
      if (escPosBytes == null || escPosBytes.isEmpty) {
        debugPrint('[ZEBRA] ESC/POS bytes missing');
        return const PrinterJobResult.fail(PrinterFailureCode.missingPayload);
      }
      return _sendBytes(escPosBytes, address: address);
    }

    if (zpl == null || zpl.isEmpty) {
      debugPrint('[ZEBRA] ZPL payload missing');
      return const PrinterJobResult.fail(PrinterFailureCode.missingPayload);
    }
    return printZpl(zpl, address: address);
  }

  // -- Helpers --

  static String _toAscii(String text) {
    const replacements = <String, String>{
      'á': 'a',
      'é': 'e',
      'í': 'i',
      'ó': 'o',
      'ú': 'u',
      'Á': 'A',
      'É': 'E',
      'Í': 'I',
      'Ó': 'O',
      'Ú': 'U',
      'ñ': 'n',
      'Ñ': 'N',
      'ü': 'u',
      'Ü': 'U',
      '€': 'EUR',
      '·': '-',
    };
    var result = text;
    replacements.forEach((from, to) {
      result = result.replaceAll(from, to);
    });
    return String.fromCharCodes(
      result.codeUnits.where((c) => c >= 32 && c < 127),
    );
  }

  static String _formatQuantity(num value) {
    final fixed = value.toDouble().toStringAsFixed(3);
    return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
  }

  static String _truncate(String text, int maxLen) {
    if (maxLen <= 0) return '';
    if (text.length <= maxLen) return text;
    if (maxLen == 1) return '~';
    return '${text.substring(0, maxLen - 1)}~';
  }

  static List<String> _wrapText(String text, int maxLen) {
    final words = text.split(' ');
    final lines = <String>[];
    var current = '';
    for (final word in words) {
      if (current.isEmpty) {
        current = word;
      } else if (current.length + 1 + word.length <= maxLen) {
        current += ' $word';
      } else {
        lines.add(current);
        current = word;
      }
    }
    if (current.isNotEmpty) lines.add(current);
    return lines;
  }
}
