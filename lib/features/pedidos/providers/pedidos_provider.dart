/// Pedidos Provider — shim deprecated (fase4 WS-C5 gmp-riverpod-unico-test-001).
///
/// Fase4: el provider mutable viejo (~2270 líneas, clase viva + 7 helpers
/// puros) se desmonta. Los helpers viven ahora en `pedidos_helpers.dart`
/// (re-exportados aquí para compat con tests que importan esta ruta con
/// `show:`). El estado único vive en `pedidos_notifier.dart`
/// ([PedidosNotifier] + [pedidosNotifierProvider]).
///
/// No borrar este archivo: mantiene la ruta de import histórica y el
/// historial en git. Sin lógica, sin estado, sin UI visible.
library;

export 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_helpers.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_notifier.dart';

/// Alias histórico del tipo del provider. Resolver a [PedidosNotifier].
typedef PedidosProvider = PedidosNotifier;

/// Acceso histórico al provider único. Usar [pedidosNotifierProvider].
@deprecated
NotifierProvider<PedidosNotifier, PedidosState> get pedidosProvider =>
    pedidosNotifierProvider;
