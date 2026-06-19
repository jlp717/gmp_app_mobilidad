import 'package:flutter_riverpod/flutter_riverpod.dart';

// Provider para manejar datos de cliente pendientes
final pendingClientProvider =
    StateNotifierProvider<PendingClientNotifier, Map<String, dynamic>?>(
  (ref) => PendingClientNotifier(),
);

class PendingClientNotifier extends StateNotifier<Map<String, dynamic>?> {
  PendingClientNotifier() : super(null);

  void setPendingClient(String clientId, String clientName) {
    state = {
      'clientId': clientId,
      'clientName': clientName,
    };
  }

  void clearPendingClient() {
    state = null;
  }
}
