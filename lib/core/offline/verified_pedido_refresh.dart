/// Auth- and scope-bound coordinator for the read refresh that follows a
/// canonical offline order acknowledgement.
class VerifiedPedidoRefresh {
  const VerifiedPedidoRefresh._();

  static Future<bool> run({
    required String scope,
    required int authEpoch,
    required List<int> orderIds,
    required bool Function() isMounted,
    required String Function() currentScope,
    required int Function() currentAuthEpoch,
    required Future<void> Function() invalidate,
    required Future<void> Function(int expectedAuthEpoch) refresh,
  }) async {
    bool isCurrent() =>
        isMounted() &&
        orderIds.isNotEmpty &&
        scope == currentScope() &&
        authEpoch == currentAuthEpoch();

    if (!isCurrent()) return false;
    await invalidate();
    if (!isCurrent()) return false;
    await refresh(authEpoch);
    return isCurrent();
  }
}
