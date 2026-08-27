import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class RuteroNavigationButton extends StatefulWidget {
  const RuteroNavigationButton(
      {super.key, required this.lat, required this.lng, this.launcher});
  final double lat;
  final double lng;
  final Future<bool> Function(Uri)? launcher;
  @override
  State<RuteroNavigationButton> createState() => _RuteroNavigationButtonState();
}

class _RuteroNavigationButtonState extends State<RuteroNavigationButton> {
  bool _opening = false;
  Future<void> _open() async {
    setState(() => _opening = true);
    var opened = false;
    try {
      final url = Uri.https('www.google.com', '/maps/dir/', {
        'api': '1',
        'destination': '${widget.lat},${widget.lng}',
        'travelmode': 'driving',
      });
      opened = await (widget.launcher?.call(url) ??
              launchUrl(url, mode: LaunchMode.externalApplication))
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      // A failed launch is actionable, never silently discarded.
    }
    if (!mounted) return;
    setState(() => _opening = false);
    if (!opened)
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'No se pudo abrir la navegación. Comprueba que tienes una aplicación de mapas e inténtalo de nuevo.'),
      ));
  }

  @override
  Widget build(BuildContext context) => FilledButton.icon(
        onPressed: _opening ? null : _open,
        icon: const Icon(Icons.navigation),
        label:
            Text(_opening ? 'Abriendo navegación…' : 'Navegar a esta parada'),
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      );
}
