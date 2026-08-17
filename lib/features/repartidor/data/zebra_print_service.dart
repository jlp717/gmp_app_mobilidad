import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bluetooth_printer/flutter_bluetooth_printer.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
        return 'No se pudo enviar el ticket. Revisa que la impresora esté vinculada y con papel.';
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
  }

  // -- Bluetooth permissions --

  /// Check and request BT permissions. Skips re-request if already granted.
  static Future<bool> requestBluetoothPermissions() async {
    // Fast path: check if already granted before triggering system dialog
    final connectStatus = await Permission.bluetoothConnect.status;
    final scanStatus = await Permission.bluetoothScan.status;
    final locationStatus = await Permission.locationWhenInUse.status;

    if ((connectStatus.isGranted || connectStatus.isLimited) &&
        (scanStatus.isGranted || scanStatus.isLimited) &&
        (locationStatus.isGranted || locationStatus.isLimited)) {
      return true;
    }

    final statuses = await [
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.locationWhenInUse,
    ].request();

    final allGranted = statuses.values.every(
      (s) => s.isGranted || s.isLimited,
    );
    if (!allGranted) {
      debugPrint('[ZEBRA] BT permissions not granted');
    }
    return allGranted;
  }

  // -- Bluetooth state --

  /// Check if Bluetooth adapter is enabled.
  static Future<bool> isBluetoothEnabled() async {
    try {
      final state = await FlutterBluetoothPrinter.getState();
      return state == BluetoothState.enabled ||
          state == BluetoothState.permitted;
    } catch (_) {
      return false;
    }
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

  /// Column positions matching PDF layout:
  /// Ptda | Artículo/Descripción | Bultos | Imp.Neto
  static const int _colPtda = 20;
  static const int _colDesc = 60;
  static const int _colBult = 400;
  static const int _colImp = 470;
  static const int _lineW = 550;
  static const int _xLeft = 20;

  /// Convert PNG signature bytes to ZPL GRF (Graphic Field ASCII) format.
  /// Returns a `^GFA,...` command string or null on failure.
  static Future<String?> convertSignatureToGrf(
    Uint8List pngBytes, {
    int maxWidth = 300,
    int maxHeight = 100,
  }) async {
    try {
      return await () async {
        final codec = await ui.instantiateImageCodec(
          pngBytes,
          targetWidth: maxWidth,
          targetHeight: maxHeight,
        );
        final frame = await codec.getNextFrame();
        final image = frame.image;

        final byteData = await image.toByteData();
        if (byteData == null) return null;

        final pixels = byteData.buffer.asUint8List();
        final srcW = image.width;
        final srcH = image.height;

        // Scale to fit within maxWidth x maxHeight
        final scaleX = srcW > maxWidth ? maxWidth / srcW : 1.0;
        final scaleY = srcH > maxHeight ? maxHeight / srcH : 1.0;
        final scale = scaleX < scaleY ? scaleX : scaleY;
        final outW = (srcW * scale).toInt();
        final outH = (srcH * scale).toInt();

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
                // Luminance < 128 = black (ink on paper)
                if ((r * 299 + g * 587 + b * 114) ~/ 1000 < 128) {
                  byte |= 0x80 >> bit;
                }
              }
            }
            hex.write(byte.toRadixString(16).padLeft(2, '0').toUpperCase());
          }
        }

        return '^GFA,$totalBytes,$totalBytes,$bytesPerRow,$hex';
      }()
          .timeout(const Duration(seconds: 4));
    } catch (_) {
      debugPrint('[ZEBRA] GRF conversion failed or timed out');
      return null;
    }
  }

  /// Strip leading numeric vendor code from name (e.g., "08 DAMIAN" → "DAMIAN")
  static String _stripCodePrefix(String name) {
    return name.replaceFirst(RegExp(r'^\d+\s+'), '').trim();
  }

  /// Escape ZPL special characters in field data to prevent ZPL injection.
  /// ZPL interprets ^ and ~ as command prefixes even within ^FD...^FS blocks.
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
  }) {
    final buf = StringBuffer();
    var y = 25;

    buf.writeln('^XA');
    buf.writeln('^CI28'); // UTF-8 for Spanish chars
    buf.writeln('^MNN'); // Continuous media mode (receipt paper)

    // ═══ HEADER — Company ═══
    buf.writeln('^CF0,30');
    buf.writeln('^FO$_xLeft,$y^FDGRANJA MARI PEPA S.L.^FS');
    y += 34;
    buf.writeln('^CF0,16');
    buf.writeln(
      '^FO$_xLeft,$y^FDPol. Ind. Saprelorca - Parcela D3^FS',
    );
    y += 20;
    buf.writeln(
      '^FO$_xLeft,$y^FD30817 Lorca (Murcia)^FS',
    );
    y += 20;
    buf.writeln(
      '^FO$_xLeft,$y^FDCIF: B04008710 · Tel: 968 47 08 80^FS',
    );
    y += 26;

    // Double separator
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,2,2^FS');
    y += 5;
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 10;

    // ═══ DOCUMENT TYPE + NUMBER (full reference: serie-terminal-numero) ═══
    final isFactura = albaran.numeroFactura > 0;
    final docType = isFactura ? 'FACTURA' : 'ALBARAN';
    final docNum = isFactura
        ? '${albaran.serieFactura}-${albaran.terminal}-${albaran.numeroFactura}'
        : '${albaran.serie}-${albaran.terminal}-${albaran.numeroAlbaran}';
    buf.writeln('^CF0,28');
    buf.writeln('^FO$_xLeft,$y^FD$docType: ${_sanitizeZpl(docNum)}^FS');
    y += 32;
    buf.writeln('^CF0,18');
    buf.writeln('^FO$_xLeft,$y^FDFecha: ${albaran.fecha}^FS');
    y += 24;
    if (albaran.ordenPreparacion != null) {
      buf.writeln('^CF0,18');
      buf.writeln(
        '^FO$_xLeft,$y^FDOrden Prep.: ${albaran.ordenPreparacion!}^FS',
      );
      y += 24;
    }

    // ═══ CLIENT INFO ═══
    buf.writeln('^CF0,20');
    buf.writeln(
      '^FO$_xLeft,$y^FDCliente: ${_sanitizeZpl(albaran.codigoCliente)}^FS',
    );
    y += 24;
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO$_xLeft,$y^FD${_truncate(_sanitizeZpl(albaran.nombreCliente), 42)}^FS',
    );
    y += 22;
    if (albaran.direccion.isNotEmpty) {
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_xLeft,$y^FD${_truncate(_sanitizeZpl(albaran.direccion), 46)}^FS',
      );
      y += 20;
    }
    buf.writeln('^CF0,16');
    buf.writeln(
      '^FO$_xLeft,$y^FDForma de pago: ${_sanitizeZpl(albaran.formaPagoDesc)}^FS',
    );
    y += 24;

    // Separator
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 8;

    // ═══ PRODUCT TABLE HEADER ═══
    buf.writeln('^CF0,16');
    buf.writeln('^FO$_colPtda,$y^FDPtda^FS');
    buf.writeln('^FO$_colDesc,$y^FDArticulo / Descripcion^FS');
    buf.writeln('^FO$_colBult,$y^FDBultos^FS');
    buf.writeln('^FO$_colImp,$y^FDImp.Neto^FS');
    y += 20;
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 6;

    // ═══ PRODUCT LINES ═══
    var totalBultos = 0.0;
    for (var i = 0; i < items.length; i++) {
      final item = items[i];
      final partida = '${i + 1}';
      // Use CANTIDADENVASES (bultos) for the Bultos column, not CANTIDADUNIDADES
      final bultos = item.bultos > 0 ? item.bultos : item.cantidadPedida;
      totalBultos += bultos;
      final importe = item.cantidadPedida * item.precioUnitario;

      // Line 1: Ptda + article code + bultos + importe
      buf.writeln('^CF0,16');
      buf.writeln('^FO$_colPtda,$y^FD$partida^FS');
      if (item.codigoArticulo.isNotEmpty) {
        buf.writeln('^CF0,14');
        buf.writeln(
          '^FO$_colDesc,$y^FD${_truncate(_sanitizeZpl(item.codigoArticulo), 30)}^FS',
        );
      }
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_colBult,$y^FD${_formatQuantity(bultos).padLeft(4)}^FS',
      );
      buf.writeln(
        '^FO$_colImp,$y^FD${importe.toStringAsFixed(2).padLeft(8)}^FS',
      );
      y += 18;

      // Line 2: Description
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_colDesc,$y^FD${_truncate(_sanitizeZpl(item.descripcion), 38)}^FS',
      );
      y += 20;
    }

    // ═══ TOTALS SECTION ═══
    y += 4;
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,2,2^FS');
    y += 10;

    // Bultos total
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO300,$y^FDBultos: ${_formatQuantity(totalBultos)}^FS',
    );
    y += 22;

    // Importe Neto (base sin IVA)
    if (albaran.importeNeto > 0) {
      buf.writeln(
        '^FO300,$y^FDImporte Neto: '
        '${_sanitizeZpl(albaran.importeNeto.toStringAsFixed(2))} EUR^FS',
      );
      y += 22;
    }

    // IVA breakdown
    if (albaran.ivaBreakdown.isNotEmpty) {
      for (final iva in albaran.ivaBreakdown) {
        buf.writeln('^CF0,16');
        buf.writeln(
          '^FO300,$y^FDIVA ${iva.pct.toStringAsFixed(0)}%: '
          '${_sanitizeZpl(iva.iva.toStringAsFixed(2))} EUR^FS',
        );
        y += 20;
      }
    }

    y += 4;
    // TOTAL (bold/large)
    buf.writeln('^CF0,26');
    buf.writeln(
      '^FO$_xLeft,$y^FDTOTAL: '
      '${_sanitizeZpl(albaran.importeTotal.toStringAsFixed(2))} EUR^FS',
    );
    y += 32;

    // ═══ SEPARATOR ═══
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 10;

    // ═══ SIGNATURE ═══
    if (receptorNombre != null && receptorNombre.isNotEmpty) {
      buf.writeln('^CF0,18');
      buf.writeln(
        '^FO$_xLeft,$y^FDFirmante: ${_sanitizeZpl(receptorNombre)}^FS',
      );
      y += 22;
      if (receptorDni != null && receptorDni.isNotEmpty) {
        buf.writeln('^CF0,16');
        buf.writeln('^FO$_xLeft,$y^FDDNI/NIF: ${_sanitizeZpl(receptorDni)}^FS');
        y += 20;
      }

      // Render actual signature image (GRF) or fallback to box
      if (signatureGrf != null && signatureGrf.isNotEmpty) {
        buf.writeln('^FO$_xLeft,$y$signatureGrf^FS');
        y += 106; // GRF is maxHeight=100 + margin
      } else {
        buf.writeln('^FO$_xLeft,$y^GB200,60,1^FS');
        buf.writeln('^CF0,14');
        buf.writeln('^FO${_xLeft + 50},${y + 20}^FD[FIRMADO]^FS');
        y += 66;
      }

      // Fecha firma
      if (fechaFirma != null) {
        buf.writeln('^CF0,14');
        final ff = '${fechaFirma.day.toString().padLeft(2, '0')}/'
            '${fechaFirma.month.toString().padLeft(2, '0')}/'
            '${fechaFirma.year} '
            '${fechaFirma.hour.toString().padLeft(2, '0')}:'
            '${fechaFirma.minute.toString().padLeft(2, '0')}';
        buf.writeln('^FO$_xLeft,$y^FDFecha firma: $ff^FS');
        y += 18;
      }
    }

    // ═══ OBSERVATIONS ═══
    if (observaciones.isNotEmpty) {
      buf.writeln('^CF0,16');
      for (final line in _wrapText(_sanitizeZpl(observaciones), 52)) {
        buf.writeln('^FO$_xLeft,$y^FDObs: $line^FS');
        y += 18;
      }
      y += 4;
    }

    // ═══ FOOTER ═══
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 8;
    buf.writeln('^CF0,14');
    buf.writeln(
      '^FO$_xLeft,$y^FDLa posesion de este documento '
      'NO implica el pago de la misma^FS',
    );
    y += 16;
    buf.writeln(
      '^FO$_xLeft,$y^FDNo se admiten devoluciones una vez '
      'aceptada la recepcion^FS',
    );
    y += 18;
    buf.writeln('^CF0,16');
    final repartidorDisplay = _stripCodePrefix(
      albaran.nombreRepartidor.isNotEmpty
          ? albaran.nombreRepartidor
          : albaran.codigoRepartidor,
    );
    buf.writeln(
      '^FO$_xLeft,$y^FDEntregado por: ${_sanitizeZpl(repartidorDisplay)}^FS',
    );
    y += 24;

    // Set label length to match actual content (fixes double-height paper)
    buf.writeln('^LL${y + 10}');

    buf.writeln('^XZ');
    return buf.toString();
  }

  // -- ESC/POS generation --

  static const int _escPosLineWidth = 32;

  /// Simple ESC/POS ticket bytes for generic Bluetooth printers.
  /// ESC @ init, ASCII text lines (<=32 chars), GS V 0 cut.
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

    writeLine('GRANJA MARI PEPA S.L.');
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
      if (qty != null)
        parts.add(
            'x${_formatQuantity(qty is num ? qty : num.tryParse(qty.toString()) ?? 0)}');
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

  // -- Print execution --

  static const Duration _printAttemptTimeout = Duration(seconds: 12);

  static Future<PrinterJobResult> _sendBytes(
    Uint8List bytes, {
    String? address,
  }) async {
    String? addr;
    try {
      addr = address ?? await getSavedPrinterAddress();
      if (addr == null || addr.isEmpty) {
        return const PrinterJobResult.fail(PrinterFailureCode.noAddress);
      }

      final granted = await requestBluetoothPermissions();
      if (!granted) {
        return const PrinterJobResult.fail(
          PrinterFailureCode.permissionsDenied,
        );
      }

      final btOn = await isBluetoothEnabled()
          .timeout(const Duration(seconds: 3), onTimeout: () => false);
      if (!btOn) {
        return const PrinterJobResult.fail(PrinterFailureCode.bluetoothOff);
      }

      var timedOut = false;
      final ok = await FlutterBluetoothPrinter.printBytes(
        address: addr,
        data: bytes,
        keepConnected: false,
      ).timeout(_printAttemptTimeout, onTimeout: () {
        timedOut = true;
        return false;
      });
      debugPrint('[ZEBRA] Print result ok=$ok timedOut=$timedOut');
      if (ok) return const PrinterJobResult.success();
      return PrinterJobResult.fail(
        timedOut ? PrinterFailureCode.timeout : PrinterFailureCode.sendFailed,
      );
    } on TimeoutException {
      return const PrinterJobResult.fail(PrinterFailureCode.timeout);
    } catch (_) {
      debugPrint('[ZEBRA] Print failed');
      return const PrinterJobResult.fail(PrinterFailureCode.sendFailed);
    } finally {
      if (addr != null && addr.isNotEmpty) {
        await _safeDisconnect(addr);
      }
    }
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
