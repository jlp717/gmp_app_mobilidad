import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/services/network_service.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';

/// Pantalla de configuración de red
/// Permite ver y cambiar el servidor activo manualmente
class NetworkSettingsPage extends StatefulWidget {
  const NetworkSettingsPage({super.key});

  @override
  State<NetworkSettingsPage> createState() => _NetworkSettingsPageState();
}

class _NetworkSettingsPageState extends State<NetworkSettingsPage> {
  bool _isLoading = false;
  bool _isDetecting = false;
  Map<String, dynamic>? _diagnostics;
  final _customUrlController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadDiagnostics();
  }

  @override
  void dispose() {
    _customUrlController.dispose();
    super.dispose();
  }

  Future<void> _loadDiagnostics() async {
    setState(() => _isLoading = true);
    try {
      final diag = await ApiConfig.getNetworkDiagnostics();
      setState(() {
        _diagnostics = diag;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _detectBestServer() async {
    setState(() => _isDetecting = true);
    try {
      await ApiConfig.refreshConnection();
      ApiClient.reinitialize();
      await _loadDiagnostics();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('✅ Servidor detectado: ${NetworkService.activeServer?.name ?? 'N/A'}'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() => _isDetecting = false);
    }
  }

  Future<void> _setServer(String baseUrl) async {
    setState(() => _isLoading = true);
    try {
      final success = await ApiConfig.setServerManually(baseUrl);
      if (success) {
        ApiClient.reinitialize();
        await _loadDiagnostics();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Servidor configurado correctamente'),
              backgroundColor: Colors.green,
            ),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('❌ No se pudo conectar al servidor'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _addCustomServer() async {
    final url = _customUrlController.text.trim();
    if (url.isEmpty) return;

    String baseUrl = url;
    if (!baseUrl.startsWith('http')) {
      baseUrl = 'http://$baseUrl';
    }
    if (!baseUrl.endsWith('/api')) {
      baseUrl = '$baseUrl/api';
    }

    await _setServer(baseUrl);
    _customUrlController.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Configuración de Red'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : _loadDiagnostics,
            tooltip: 'Actualizar diagnóstico',
          ),
        ],
      ),
      body: _isLoading && _diagnostics == null
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildCurrentServerCard(),
                  const SizedBox(height: 24),
                  _buildAutoDetectCard(),
                  const SizedBox(height: 24),
                  _buildServersListCard(),
                  const SizedBox(height: 24),
                  _buildCustomServerCard(),
                  const SizedBox(height: 24),
                  _buildDiagnosticsCard(),
                ],
              ),
            ),
    );
  }

  Widget _buildCurrentServerCard() {
    final activeServer = NetworkService.activeServer;
    return Card(
      color: const Color(0xFF1E293B),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: activeServer != null ? Colors.green : Colors.red,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: (activeServer != null ? Colors.green : Colors.red).withOpacity(0.5),
                        blurRadius: 8,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                const Text(
                  'Servidor Activo',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (activeServer != null) ...[
              Text(
                activeServer.name,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF22D3EE),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    activeServer.isSecure ? Icons.lock : Icons.lock_open,
                    color: activeServer.isSecure ? Colors.green : Colors.amber,
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SelectableText(
                      activeServer.baseUrl,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey[400],
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    color: Colors.grey[400],
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: activeServer.baseUrl));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('URL copiada')),
                      );
                    },
                  ),
                ],
              ),
            ] else
              const Text(
                'No hay servidor configurado',
                style: TextStyle(color: Colors.red),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildAutoDetectCard() {
    return Card(
      color: const Color(0xFF1E293B),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.auto_fix_high, color: Color(0xFF22D3EE)),
                SizedBox(width: 12),
                Text(
                  'Detección Automática',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Prueba todos los servidores disponibles y selecciona el mejor.',
              style: TextStyle(color: Colors.grey[400]),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _isDetecting ? null : _detectBestServer,
                icon: _isDetecting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.search),
                label: Text(_isDetecting ? 'Detectando...' : 'Detectar Servidor'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF22D3EE),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildServersListCard() {
    final servers = NetworkService.availableServers;
    final activeUrl = NetworkService.activeBaseUrl;

    return Card(
      color: const Color(0xFF1E293B),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.dns, color: Color(0xFFA78BFA)),
                SizedBox(width: 12),
                Text(
                  'Servidores Disponibles',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...servers.map((server) {
              final isActive = server.baseUrl == activeUrl;
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  color: isActive ? const Color(0xFF22D3EE).withOpacity(0.1) : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isActive ? const Color(0xFF22D3EE) : Colors.grey[700]!,
                  ),
                ),
                child: ListTile(
                  leading: Icon(
                    server.isSecure ? Icons.lock : Icons.public,
                    color: isActive ? const Color(0xFF22D3EE) : Colors.grey[400],
                  ),
                  title: Text(
                    server.name,
                    style: TextStyle(
                      color: isActive ? const Color(0xFF22D3EE) : Colors.white,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  subtitle: Text(
                    server.baseUrl,
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.grey[500],
                      fontFamily: 'monospace',
                    ),
                  ),
                  trailing: isActive
                      ? const Chip(
                          label: Text('ACTIVO'),
                          backgroundColor: Color(0xFF22D3EE),
                          labelStyle: TextStyle(color: Colors.black, fontSize: 10),
                        )
                      : TextButton(
                          onPressed: () => _setServer(server.baseUrl),
                          child: const Text('USAR'),
                        ),
                ),
              );
            }).toList(),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomServerCard() {
    return Card(
      color: const Color(0xFF1E293B),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.add_link, color: Color(0xFFF472B6)),
                SizedBox(width: 12),
                Text(
                  'Servidor Personalizado',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Ingresa una URL personalizada si conoces la IP del servidor.',
              style: TextStyle(color: Colors.grey[400]),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _customUrlController,
                    decoration: InputDecoration(
                      hintText: 'ej: 192.168.1.100:3000',
                      hintStyle: TextStyle(color: Colors.grey[600]),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide.none,
                      ),
                      prefixIcon: const Icon(Icons.link, color: Colors.grey),
                    ),
                    style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
                    onSubmitted: (_) => _addCustomServer(),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: _addCustomServer,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF472B6),
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                  ),
                  child: const Text('Probar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDiagnosticsCard() {
    if (_diagnostics == null) return const SizedBox.shrink();

    return Card(
      color: const Color(0xFF1E293B),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.bug_report, color: Color(0xFF4ADE80)),
                    SizedBox(width: 12),
                    Text(
                      'Diagnóstico de Red',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.copy_all),
                  color: Colors.grey[400],
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: _diagnostics.toString()));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Diagnóstico copiado')),
                    );
                  },
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF0F172A),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _diagRow('Plataforma', (_diagnostics!['platform'] as String?) ?? 'N/A'),
                  _diagRow('Inicializado', _diagnostics!['isInitialized']?.toString() ?? 'N/A'),
                  _diagRow('Servidor Activo', (_diagnostics!['activeServer'] as String?) ?? 'N/A'),
                  const Divider(color: Colors.grey),
                  const Text(
                    'Test de Conectividad:',
                    style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  if (_diagnostics!['servers'] != null)
                    ...(_diagnostics!['servers'] as List).map((s) {
                      final status = s['status'] as String;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(
                          children: [
                            Icon(
                              status == 'OK' ? Icons.check_circle : Icons.cancel,
                              color: status == 'OK' ? Colors.green : Colors.red,
                              size: 16,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                (s['name'] as String?) ?? '',
                                style: TextStyle(
                                  color: s['isActive'] == true ? const Color(0xFF22D3EE) : Colors.white70,
                                ),
                              ),
                            ),
                            Text(
                              status,
                              style: TextStyle(
                                color: status == 'OK' ? Colors.green : Colors.red,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _diagRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              '$label:',
              style: const TextStyle(color: Colors.grey),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}
