const _endpointGroups = <String>{
  'auth',
  'dashboard',
  'analytics',
  'clients',
  'router',
  'rutero',
  'objectives',
  'products',
  'vendedores',
  'pedidos',
  'commissions',
  'kpi',
  'facturas',
  'export',
  'health',
  'bolsa',
  'cobros',
  'chatbot',
  'repartidor',
  'entregas',
  'logs',
};
const _screens = <String>{
  'login',
  'dashboard',
  'pedidos',
  'clientes',
  'rutero',
  'reparto',
  'cobros',
  'facturas',
  'commissions',
  'warehouse',
  'chatbot',
};
const _methods = <String>{'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UI'};
const _nets = <String>{'wifi', 'mobile', 'none'};

/// Removes unbounded strings and retains only RUM dimensions used for metrics.
Map<String, dynamic>? sanitizeRumEvent(Map<String, dynamic> event) {
  final requestTime = _finite(event['t_req']);
  if (requestTime == null) return null;
  final result = <String, dynamic>{
    'screen': rumScreen(event['screen']),
    'endpoint': rumEndpointGroup(event['endpoint']),
    'method': rumMethod(event['method']),
    'status': _status(event['status']),
    't_req': requestTime,
    'bytes': _bytes(event['bytes']),
    'net': rumNet(event['net']),
  };
  for (final key in const <String>['t_resp', 't_parsed', 't_render']) {
    final value = _finite(event[key]);
    if (value != null) result[key] = value;
  }
  return result;
}

/// Returns a fixed endpoint group without path segments or query text.
String rumEndpointGroup(Object? value) {
  if (value == 'render') return 'render';
  if (value is! String ||
      value.startsWith('http:') ||
      value.startsWith('https:')) {
    return 'other';
  }
  final path = value.split(RegExp('[?#]')).first;
  final parts = path.split('/').where((part) => part.isNotEmpty).toList();
  if (parts.isNotEmpty && parts.first == 'api') {
    parts.removeAt(0);
  }
  if (parts.isEmpty || !_endpointGroups.contains(parts.first)) return 'other';
  return '/${parts.first}';
}

/// Returns an allowed screen category or `unknown`.
String rumScreen(Object? value) =>
    value is String && _screens.contains(value) ? value : 'unknown';

/// Returns an allowed request method category or `OTHER`.
String rumMethod(Object? value) {
  final normalized = value is String ? value.toUpperCase() : '';
  return _methods.contains(normalized) ? normalized : 'OTHER';
}

/// Returns an allowed network category or `unknown`.
String rumNet(Object? value) {
  final normalized = value is String ? value.toLowerCase() : '';
  return _nets.contains(normalized) ? normalized : 'unknown';
}

num? _finite(Object? value) => value is num && value.isFinite ? value : null;
int? _status(Object? value) =>
    value is int && value >= 100 && value <= 599 ? value : null;
int? _bytes(Object? value) => value is int && value >= 0 ? value : null;
