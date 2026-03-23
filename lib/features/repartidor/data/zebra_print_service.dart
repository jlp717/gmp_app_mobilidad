import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bluetooth_printer/flutter_bluetooth_printer.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

/// Service for printing delivery notes on Zebra ZQ520
/// via Bluetooth Classic (SPP/RFCOMM) using raw ZPL commands.
class ZebraPrintService {
  static const String _prefKey = 'repartidor_tiene_impresora';
  static const String _prefAddress = 'repartidor_printer_address';
  static const String _prefName = 'repartidor_printer_name';

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

  static Future<void> savePrinter(
    String address,
    String name,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefAddress, address);
    await prefs.setString(_prefName, name);
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
      debugPrint(
        '[ZEBRA] BT permissions not granted: $statuses',
      );
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

  /// Test connection to the saved (or given) printer.
  /// Returns true if the printer is reachable via BT.
  /// Includes a 12s timeout to prevent indefinite hangs.
  static Future<bool> testConnection({String? address}) async {
    try {
      final addr = address ?? await getSavedPrinterAddress();
      if (addr == null) return false;

      final granted = await requestBluetoothPermissions();
      if (!granted) return false;

      final connected = await FlutterBluetoothPrinter.connect(addr)
          .timeout(const Duration(seconds: 12), onTimeout: () => false);
      if (connected) {
        await FlutterBluetoothPrinter.disconnect(addr);
      }
      return connected;
    } catch (e) {
      debugPrint('[ZEBRA] Connection test error: $e');
      return false;
    }
  }

  /// Global connection state notifier from the BT library.
  static ValueNotifier<BluetoothConnectionState>
      get connectionStateNotifier =>
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
      final codec = await ui.instantiateImageCodec(pngBytes);
      final frame = await codec.getNextFrame();
      final image = frame.image;

      final byteData = await image.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      );
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

      for (int row = 0; row < outH; row++) {
        for (int col = 0; col < bytesPerRow; col++) {
          int byte = 0;
          for (int bit = 0; bit < 8; bit++) {
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
                byte |= (0x80 >> bit);
              }
            }
          }
          hex.write(byte.toRadixString(16).padLeft(2, '0').toUpperCase());
        }
      }

      return '^GFA,$totalBytes,$totalBytes,$bytesPerRow,${hex.toString()}';
    } catch (e) {
      debugPrint('[ZEBRA] GRF conversion error: $e');
      return null;
    }
  }

  /// Strip leading numeric vendor code from name (e.g., "08 DAMIAN" → "DAMIAN")
  static String _stripCodePrefix(String name) {
    return name.replaceFirst(RegExp(r'^\d+\s+'), '').trim();
  }

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
    int y = 25;

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
    buf.writeln('^FO$_xLeft,$y^FD$docType: $docNum^FS');
    y += 32;
    buf.writeln('^CF0,18');
    buf.writeln('^FO$_xLeft,$y^FDFecha: ${albaran.fecha}^FS');
    y += 24;
    if (albaran.ordenPreparacion != null) {
      buf.writeln('^CF0,18');
      buf.writeln('^FO$_xLeft,$y^FDOrden Prep.: ${albaran.ordenPreparacion}^FS');
      y += 24;
    }

    // ═══ CLIENT INFO ═══
    buf.writeln('^CF0,20');
    buf.writeln(
      '^FO$_xLeft,$y^FDCliente: ${albaran.codigoCliente}^FS',
    );
    y += 24;
    buf.writeln('^CF0,18');
    buf.writeln(
      '^FO$_xLeft,$y^FD${_truncate(albaran.nombreCliente, 42)}^FS',
    );
    y += 22;
    if (albaran.direccion.isNotEmpty) {
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_xLeft,$y^FD${_truncate(albaran.direccion, 46)}^FS',
      );
      y += 20;
    }
    buf.writeln('^CF0,16');
    buf.writeln(
      '^FO$_xLeft,$y^FDForma de pago: ${albaran.formaPagoDesc}^FS',
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
    int totalBultos = 0;
    for (int i = 0; i < items.length; i++) {
      final item = items[i];
      final partida = '${i + 1}';
      // Use CANTIDADENVASES (bultos) for the Bultos column, not CANTIDADUNIDADES
      final bultos = item.bultos > 0 ? item.bultos : item.cantidadPedida.toInt();
      totalBultos += bultos;
      final importe = item.cantidadPedida * item.precioUnitario;

      // Line 1: Ptda + article code + bultos + importe
      buf.writeln('^CF0,16');
      buf.writeln('^FO$_colPtda,$y^FD$partida^FS');
      if (item.codigoArticulo.isNotEmpty) {
        buf.writeln('^CF0,14');
        buf.writeln(
          '^FO$_colDesc,$y^FD${_truncate(item.codigoArticulo, 30)}^FS',
        );
      }
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_colBult,$y^FD${bultos.toString().padLeft(4)}^FS',
      );
      buf.writeln(
        '^FO$_colImp,$y^FD${importe.toStringAsFixed(2).padLeft(8)}^FS',
      );
      y += 18;

      // Line 2: Description
      buf.writeln('^CF0,16');
      buf.writeln(
        '^FO$_colDesc,$y^FD${_truncate(item.descripcion, 38)}^FS',
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
      '^FO300,$y^FDBultos: $totalBultos^FS',
    );
    y += 22;

    // Importe Neto (base sin IVA)
    if (albaran.importeNeto > 0) {
      buf.writeln(
        '^FO300,$y^FDImporte Neto: '
        '${albaran.importeNeto.toStringAsFixed(2)} EUR^FS',
      );
      y += 22;
    }

    // IVA breakdown
    if (albaran.ivaBreakdown.isNotEmpty) {
      for (final iva in albaran.ivaBreakdown) {
        buf.writeln('^CF0,16');
        buf.writeln(
          '^FO300,$y^FDIVA ${iva.pct.toStringAsFixed(0)}%: '
          '${iva.iva.toStringAsFixed(2)} EUR^FS',
        );
        y += 20;
      }
    }

    y += 4;
    // TOTAL (bold/large)
    buf.writeln('^CF0,26');
    buf.writeln(
      '^FO$_xLeft,$y^FDTOTAL: '
      '${albaran.importeTotal.toStringAsFixed(2)} EUR^FS',
    );
    y += 32;

    // ═══ SEPARATOR ═══
    buf.writeln('^FO$_xLeft,$y^GB$_lineW,1,1^FS');
    y += 10;

    // ═══ SIGNATURE ═══
    if (receptorNombre != null && receptorNombre.isNotEmpty) {
      buf.writeln('^CF0,18');
      buf.writeln(
        '^FO$_xLeft,$y^FDFirmante: $receptorNombre^FS',
      );
      y += 22;
      if (receptorDni != null && receptorDni.isNotEmpty) {
        buf.writeln('^CF0,16');
        buf.writeln('^FO$_xLeft,$y^FDDNI/NIF: $receptorDni^FS');
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
      for (final line in _wrapText(observaciones, 52)) {
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
      '^FO$_xLeft,$y^FDEntregado por: $repartidorDisplay^FS',
    );
    y += 24;

    // Set label length to match actual content (fixes double-height paper)
    buf.writeln('^LL${y + 10}');

    buf.writeln('^XZ');
    return buf.toString();
  }

  // -- Print execution --

  /// Sends raw ZPL to the saved (or given) printer.
  /// Returns true on success, false on failure.
  /// Retries once on failure with a 2s backoff.
  static Future<bool> printZpl(
    String zplData, {
    String? address,
  }) async {
    try {
      final addr = address ?? await getSavedPrinterAddress();
      if (addr == null) {
        debugPrint('[ZEBRA] No printer address configured');
        return false;
      }

      final granted = await requestBluetoothPermissions();
      if (!granted) return false;

      final bytes = Uint8List.fromList(utf8.encode(zplData));

      // Attempt with 1 automatic retry on failure
      for (int attempt = 0; attempt < 2; attempt++) {
        try {
          final ok = await FlutterBluetoothPrinter.printBytes(
            address: addr,
            data: bytes,
            keepConnected: false,
          ).timeout(const Duration(seconds: 15), onTimeout: () => false);

          debugPrint('[ZEBRA] Print attempt ${attempt + 1}: $ok');
          if (ok) return true;
        } catch (e) {
          debugPrint('[ZEBRA] Print attempt ${attempt + 1} error: $e');
        }
        if (attempt == 0) {
          await Future<void>.delayed(const Duration(seconds: 2));
        }
      }
      return false;
    } catch (e) {
      debugPrint('[ZEBRA] Print error: $e');
      return false;
    }
  }

  // -- Helpers --

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
