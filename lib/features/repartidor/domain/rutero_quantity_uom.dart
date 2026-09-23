import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

/// Shared driver-facing quantity helpers for rutero (UI, ticket, PDF notes).
///
/// LAC often stores piece counts in [EntregaItem.cantidadPedida] while
/// [EntregaItem.bultos]/[cantidadEnvases] holds packed boxes. When the ratio
/// is an integer factor > 1 (e.g. 1 caja × 27 baguettes), drivers must see
/// cajas — never raw piezas.

String formatRuteroQuantity(num value) {
  final fixed = value.toDouble().toStringAsFixed(3);
  return fixed.replaceFirst(RegExp(r'\.?0+$'), '').replaceAll('.', ',');
}

/// True when LAC ships packed boxes whose pieces fill an integer factor.
bool ruteroPrefersBoxQuantity(EntregaItem item) {
  final boxes = item.bultos;
  final pieces = item.cantidadPedida;
  if (boxes <= 0.0001 || pieces <= 0.0001) return false;
  final unit = (item.unit ?? '').trim().toUpperCase();
  if (unit.contains('KG') ||
      unit.contains('KILO') ||
      unit.contains('GRAM') ||
      unit == 'G' ||
      unit == 'GR' ||
      unit.contains('LITR') ||
      unit == 'LT' ||
      unit == 'L') {
    return false;
  }
  if (unit.contains('CAJ') ||
      unit == 'CJ' ||
      unit.contains('BOX') ||
      unit.contains('ENVASE')) {
    // Unit already says boxes: only remap when pedida is the piece count.
    return pieces > boxes + 0.0001;
  }
  final factor = pieces / boxes;
  if (factor <= 1.001) return false;
  return (factor - factor.roundToDouble()).abs() < 0.001;
}

/// Pieces per box when [ruteroPrefersBoxQuantity] applies; otherwise 1.
double ruteroUnitsPerBox(EntregaItem item) {
  if (!ruteroPrefersBoxQuantity(item)) return 1;
  return item.cantidadPedida / item.bultos;
}

/// Ordered qty in the unit the driver edits (cajas or piezas/kg).
double ruteroDriverFacingOrderedQty(EntregaItem item) =>
    ruteroPrefersBoxQuantity(item) ? item.bultos : item.cantidadPedida;

/// Canonical (LAC) qty ↔ driver-facing qty.
double ruteroCanonicalFromFacing(EntregaItem item, num facingQty) {
  final factor = ruteroUnitsPerBox(item);
  return double.parse((facingQty.toDouble() * factor).toStringAsFixed(3));
}

double ruteroFacingFromCanonical(EntregaItem item, num canonicalQty) {
  final factor = ruteroUnitsPerBox(item);
  if (factor <= 1.0001) return canonicalQty.toDouble();
  return double.parse((canonicalQty.toDouble() / factor).toStringAsFixed(3));
}

/// Driver-facing unit: kg for weight (pollo 5,75), cajas for boxes.
String ruteroQuantityUnitLabel(String? unit, {num? quantity}) {
  final raw = (unit ?? '').trim();
  final u = raw.toUpperCase();
  if (u.contains('KG') ||
      u.contains('KILO') ||
      u == 'G' ||
      u == 'GR' ||
      u.contains('GRAM')) {
    return 'kg';
  }
  if (u.contains('LITR') || u == 'LT' || u == 'L') {
    return 'l';
  }
  if (u.contains('CAJ') ||
      u == 'CJ' ||
      u.contains('BOX') ||
      u.contains('ENVASE')) {
    return 'cajas';
  }
  if (u.contains('UNIDAD') || u == 'UN' || u == 'UD' || u == 'UDS') {
    return 'uds';
  }
  if (raw.isEmpty && quantity != null) {
    final ordered = quantity.toDouble();
    if ((ordered - ordered.roundToDouble()).abs() > 0.0001) return 'kg';
  }
  return raw.toLowerCase();
}

/// Unit label for a delivery line, preferring "caja/cajas" when packed.
String ruteroLineQuantityUnitLabel(EntregaItem item) {
  if (ruteroPrefersBoxQuantity(item)) {
    final facing = ruteroDriverFacingOrderedQty(item);
    return facing.abs() == 1 ? 'caja' : 'cajas';
  }
  return ruteroQuantityUnitLabel(
    item.unit,
    quantity: item.cantidadPedida,
  );
}

/// Qty shown on tickets / print preview (facing boxes when packed).
double ruteroPrintFacingQuantity(EntregaItem item, {num? deliveredCanonical}) {
  final delivered =
      (deliveredCanonical ?? item.cantidadEntregada ?? item.cantidadPedida)
          .toDouble();
  if (isWeightLikeUnit(item.unit)) {
    return delivered;
  }
  if (ruteroPrefersBoxQuantity(item)) {
    return ruteroFacingFromCanonical(item, delivered);
  }
  if (item.bultos > 0.0001 && item.cantidadPedida > 0.0001) {
    final scaled = item.bultos * (delivered / item.cantidadPedida);
    return double.parse(scaled.toStringAsFixed(3));
  }
  return delivered;
}

/// Human label for a qty change in driver-facing units.
String ruteroFacingQuantityChangeLabel(
  EntregaItem item, {
  required num fromCanonical,
  required num toCanonical,
}) {
  final fromFacing = ruteroFacingFromCanonical(item, fromCanonical);
  final toFacing = ruteroFacingFromCanonical(item, toCanonical);
  final unit = ruteroLineQuantityUnitLabel(item);
  final fromText = formatRuteroQuantity(fromFacing);
  final toText = formatRuteroQuantity(toFacing);
  if (unit.isEmpty) return '$fromText -> $toText';
  return '$fromText $unit -> $toText $unit';
}

/// Step for +/- controls: weight units use 0.1, piece units use 1.
double quantityStepForUnit(String? unit) {
  final u = (unit ?? '').trim().toUpperCase();
  if (u.isEmpty) return 1;
  if (u.contains('KG') ||
      u.contains('KILO') ||
      u == 'G' ||
      u == 'GR' ||
      u.contains('GRAM') ||
      u == 'LT' ||
      u == 'L' ||
      u.contains('LITR')) {
    return 0.1;
  }
  return 1;
}

/// Prefer unit; if unit empty but ordered qty is fractional (carne a peso), use 0.1.
double quantityStepForLine({required num cantidadPedida, String? unit}) {
  if (quantityStepForUnit(unit) < 1) return 0.1;
  final ordered = cantidadPedida.toDouble();
  if ((ordered - ordered.roundToDouble()).abs() > 0.0001) return 0.1;
  return 1;
}

/// Canonical step used by +/- / dialog for a concrete line.
double quantityStepForDeliveryLine(EntregaItem item) {
  if (ruteroPrefersBoxQuantity(item)) return ruteroUnitsPerBox(item);
  return quantityStepForLine(
    unit: item.unit,
    cantidadPedida: item.cantidadPedida,
  );
}

bool isWeightLikeUnit(String? unit) => quantityStepForUnit(unit) < 1;

/// Over-delivery ceiling: up to 10× the ordered quantity (sanity cap 9999).
double ruteroMaxDeliverableQuantity(num ordered) {
  final base = ordered.toDouble();
  if (base <= 0) return 9999;
  final cap = base * 10;
  return cap > 9999 ? 9999 : cap;
}
