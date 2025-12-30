import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../../../../core/theme/app_theme.dart';

/// OpenStreetMap Widget - 100% Free, no API key needed
class ClientMapView extends StatefulWidget {
  final List<ClientLocation> clients;
  final LatLng? initialCenter;
  final double initialZoom;
  final Function(ClientLocation)? onClientTap;

  const ClientMapView({
    super.key,
    required this.clients,
    this.initialCenter,
    this.initialZoom = 10.0,
    this.onClientTap,
  });

  @override
  State<ClientMapView> createState() => _ClientMapViewState();
}

class _ClientMapViewState extends State<ClientMapView> {
  late MapController _mapController;
  ClientLocation? _selectedClient;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  LatLng get _center {
    if (widget.initialCenter != null) return widget.initialCenter!;
    
    // Default to Almería, Spain (assuming GMP is in this region)
    if (widget.clients.isEmpty) return const LatLng(36.8340, -2.4637);
    
    // Calculate center from clients
    double avgLat = 0, avgLng = 0;
    int count = 0;
    for (final client in widget.clients) {
      if (client.latitude != null && client.longitude != null) {
        avgLat += client.latitude!;
        avgLng += client.longitude!;
        count++;
      }
    }
    if (count > 0) {
      return LatLng(avgLat / count, avgLng / count);
    }
    return const LatLng(36.8340, -2.4637);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // Map
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _center,
            initialZoom: widget.initialZoom,
            minZoom: 5,
            maxZoom: 18,
            onTap: (_, __) => setState(() => _selectedClient = null),
          ),
          children: [
            // OpenStreetMap Tile Layer (FREE)
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.gmp.mobilidad',
              maxZoom: 19,
            ),
            
            // Client Markers
            MarkerLayer(
              markers: widget.clients
                  .where((c) => c.latitude != null && c.longitude != null)
                  .map((client) => _buildMarker(client))
                  .toList(),
            ),
          ],
        ),
        
        // Map Controls
        Positioned(
          bottom: 16,
          right: 16,
          child: Column(
            children: [
              _MapButton(
                icon: Icons.add,
                onPressed: () => _mapController.move(
                  _mapController.camera.center,
                  _mapController.camera.zoom + 1,
                ),
              ),
              const SizedBox(height: 8),
              _MapButton(
                icon: Icons.remove,
                onPressed: () => _mapController.move(
                  _mapController.camera.center,
                  _mapController.camera.zoom - 1,
                ),
              ),
              const SizedBox(height: 8),
              _MapButton(
                icon: Icons.my_location,
                onPressed: () => _mapController.move(_center, widget.initialZoom),
              ),
            ],
          ),
        ),
        
        // Selected Client Info
        if (_selectedClient != null)
          Positioned(
            bottom: 16,
            left: 16,
            right: 80,
            child: _ClientInfoCard(
              client: _selectedClient!,
              onClose: () => setState(() => _selectedClient = null),
              onTap: () {
                if (widget.onClientTap != null) {
                  widget.onClientTap!(_selectedClient!);
                }
              },
            ),
          ),
        
        // Legend
        Positioned(
          top: 16,
          left: 16,
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.darkBase.withOpacity(0.9),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.location_pin, color: AppTheme.success, size: 20),
                const SizedBox(width: 4),
                Text('${widget.clients.where((c) => c.latitude != null).length} clientes', 
                     style: const TextStyle(fontSize: 12)),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Marker _buildMarker(ClientLocation client) {
    final isSelected = _selectedClient?.code == client.code;
    
    return Marker(
      point: LatLng(client.latitude!, client.longitude!),
      width: isSelected ? 50 : 40,
      height: isSelected ? 50 : 40,
      child: GestureDetector(
        onTap: () {
          setState(() => _selectedClient = client);
        },
        child: Container(
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.neonBlue : AppTheme.success,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.3),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Icon(
            Icons.store,
            color: Colors.white,
            size: isSelected ? 24 : 20,
          ),
        ),
      ),
    );
  }
}

class _MapButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onPressed;

  const _MapButton({required this.icon, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.surfaceColor,
      borderRadius: BorderRadius.circular(8),
      elevation: 4,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Icon(icon, size: 20),
        ),
      ),
    );
  }
}

class _ClientInfoCard extends StatelessWidget {
  final ClientLocation client;
  final VoidCallback onClose;
  final VoidCallback onTap;

  const _ClientInfoCard({
    required this.client,
    required this.onClose,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppTheme.surfaceColor,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppTheme.neonGreen.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.store, color: AppTheme.neonGreen),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      client.name,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (client.city != null)
                      Text(
                        client.city!,
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                      ),
                    if (client.lastSale != null)
                      Text(
                        'Última venta: €${client.lastSale!.toStringAsFixed(0)}',
                        style: const TextStyle(color: AppTheme.success, fontSize: 11),
                      ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: onClose,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Model for client location data
class ClientLocation {
  final String code;
  final String name;
  final String? city;
  final double? latitude;
  final double? longitude;
  final double? lastSale;
  final String? route;

  ClientLocation({
    required this.code,
    required this.name,
    this.city,
    this.latitude,
    this.longitude,
    this.lastSale,
    this.route,
  });

  factory ClientLocation.fromJson(Map<String, dynamic> json) {
    return ClientLocation(
      code: json['code']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Sin nombre',
      city: json['city']?.toString(),
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      lastSale: (json['lastSale'] as num?)?.toDouble(),
      route: json['route']?.toString(),
    );
  }
}
