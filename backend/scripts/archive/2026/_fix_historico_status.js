// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-fix | _-scratch gitignored; fix puntual estado historico | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const p = 'c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/lib/features/repartidor/presentation/pages/repartidor_historico_page.dart';
let c = fs.readFileSync(p, 'utf8');

if (!c.includes('enum _DeliveryStatus { delivered, partial, notDelivered, pending, enRuta }')) {
  c = c.replace(
    'enum _DeliveryStatus { delivered, partial, notDelivered, enRuta }',
    'enum _DeliveryStatus { delivered, partial, notDelivered, pending, enRuta }',
  );
}

c = c.replace(
  `      case _DeliveryStatus.notDelivered:
        statusColor = AppTheme.error;
        statusIcon = Icons.cancel;
        statusLabel = 'Pendiente';
      case _DeliveryStatus.enRuta:`,
  `      case _DeliveryStatus.notDelivered:
        statusColor = AppTheme.error;
        statusIcon = Icons.cancel;
        statusLabel = 'No entregado';
      case _DeliveryStatus.pending:
        statusColor = AppTheme.warning;
        statusIcon = Icons.schedule;
        statusLabel = 'Pendiente';
      case _DeliveryStatus.enRuta:`,
);

if (!c.includes('_filterStatus = _DeliveryStatus.pending')) {
  c = c.replace(
    `      } else if (_filterStatus == _DeliveryStatus.notDelivered) {
        _filterStatus = _DeliveryStatus.enRuta;
      } else {`,
    `      } else if (_filterStatus == _DeliveryStatus.notDelivered) {
        _filterStatus = _DeliveryStatus.pending;
      } else if (_filterStatus == _DeliveryStatus.pending) {
        _filterStatus = _DeliveryStatus.enRuta;
      } else {`,
  );
}

// Ensure icon/label/color helpers cover pending
if (!c.includes('case _DeliveryStatus.pending:\n        return Icons.schedule;')) {
  c = c.replace(
    `      case _DeliveryStatus.notDelivered:
        return Icons.cancel;
      case _DeliveryStatus.enRuta:
        return Icons.local_shipping;`,
    `      case _DeliveryStatus.notDelivered:
        return Icons.cancel;
      case _DeliveryStatus.pending:
        return Icons.schedule;
      case _DeliveryStatus.enRuta:
        return Icons.local_shipping;`,
  );
}

if (!c.includes("case _DeliveryStatus.pending:\n        return 'Pendiente';")) {
  c = c.replace(
    `      case _DeliveryStatus.notDelivered:
        return 'Pendiente';
      case _DeliveryStatus.enRuta:
        return 'En Ruta';`,
    `      case _DeliveryStatus.notDelivered:
        return 'No entregado';
      case _DeliveryStatus.pending:
        return 'Pendiente';
      case _DeliveryStatus.enRuta:
        return 'En Ruta';`,
  );
}

if (!c.includes('case _DeliveryStatus.pending:\n        return AppTheme.warning;')) {
  c = c.replace(
    `      case _DeliveryStatus.notDelivered:
        return AppTheme.error;
      case _DeliveryStatus.enRuta:
        return AppTheme.info;`,
    `      case _DeliveryStatus.notDelivered:
        return AppTheme.error;
      case _DeliveryStatus.pending:
        return AppTheme.warning;
      case _DeliveryStatus.enRuta:
        return AppTheme.info;`,
  );
}

const tmp = `${p}.tmpfix`;
fs.writeFileSync(tmp, c);
console.log('wrote', tmp);
