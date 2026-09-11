String formatErpDocumentLabel({
  required String serie,
  int? terminal,
  required Object numero,
}) {
  final seriePart = serie.trim();
  final numeroPart = numero.toString().trim();
  if (seriePart.isEmpty || numeroPart.isEmpty) return '';
  if (terminal == null) return '$seriePart-$numeroPart';
  return '$seriePart-$terminal-$numeroPart';
}
