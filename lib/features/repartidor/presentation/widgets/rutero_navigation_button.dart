import 'package:flutter/foundation.dart';
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
    if (_opening) return;
    setState(() => _opening = true);
    var opened = false;
    final destination = '${widget.lat},${widget.lng}';
    final urls = kIsWeb
        ? <Uri>[]
        : switch (defaultTargetPlatform) {
            TargetPlatform.android => [
                Uri.parse('google.navigation:q=$destination&mode=d'),
                Uri.parse('geo:$destination'),
              ],
            TargetPlatform.iOS => [
                Uri.parse(
                  'comgooglemaps://?daddr=$destination&directionsmode=driving',
                ),
                Uri.parse('maps://?daddr=$destination&dirflg=d'),
              ],
            _ => <Uri>[],
          };
    for (final url in urls) {
      if (!mounted) return;
      try {
        opened = await (widget.launcher?.call(url) ??
                launchUrl(url, mode: LaunchMode.externalApplication))
            .timeout(const Duration(seconds: 10));
        if (opened) break;
      } catch (_) {
        // Try the next native app; report failure if none can open the route.
      }
    }
    if (!mounted) return;
    setState(() => _opening = false);
    if (!opened) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'No se pudo abrir la navegación. Comprueba que tienes una aplicación de mapas e inténtalo de nuevo.'),
      ));
    }
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
