// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-fix | _-scratch gitignored; fix puntual ciclo historico | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const p = 'c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/lib/features/repartidor/presentation/pages/repartidor_historico_page.dart';
let c = fs.readFileSync(p, 'utf8');
if (c.includes('_filterStatus = _DeliveryStatus.pending')) {
  console.log('ALREADY');
  process.exit(0);
}
const old = '      } else if (_filterStatus == _DeliveryStatus.notDelivered) {\r\n        _filterStatus = _DeliveryStatus.enRuta;\r\n      } else {';
const neu = '      } else if (_filterStatus == _DeliveryStatus.notDelivered) {\r\n        _filterStatus = _DeliveryStatus.pending;\r\n      } else if (_filterStatus == _DeliveryStatus.pending) {\r\n        _filterStatus = _DeliveryStatus.enRuta;\r\n      } else {';
if (!c.includes(old)) {
  console.error('MISS CRLF');
  process.exit(2);
}
c = c.replace(old, neu);
const tmp = `${p}.tmpfix`;
fs.writeFileSync(tmp, c);
try {
  fs.copyFileSync(tmp, p);
} catch (e) {
  require('child_process').execFileSync('cmd', ['/c', 'copy', '/Y', tmp, p], { stdio: 'inherit' });
}
fs.unlinkSync(tmp);
console.log('OK');
