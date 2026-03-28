import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Un widget premium para mostrar imágenes de productos con un fallback elegante.
/// Si la imagen no está disponible (ej. 404), muestra un gradiente con el código del producto
/// o sus iniciales, eliminando el fallo visual y manteniendo la UX.
class SmartProductImage extends StatelessWidget {
  final String imageUrl;
  final String productCode;
  final String? productName;
  final double width;
  final double height;
  final BoxFit fit;
  final BorderRadiusGeometry? borderRadius;
  final bool showCodeOnFallback;
  final Map<String, String>? headers;

  const SmartProductImage({
    super.key,
    required this.imageUrl,
    required this.productCode,
    this.productName,
    this.width = double.infinity,
    this.height = double.infinity,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.showCodeOnFallback = true,
    this.headers,
  });

  @override
  Widget build(BuildContext context) {
    if (imageUrl.isEmpty) {
      return _buildFallback();
    }

    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(8),
      child: Image.network(
        imageUrl,
        headers: headers,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (context, error, stackTrace) {
          // La imagen ha dado 404 o fetch failed. Reemplazar por contenedor premium.
          return _buildFallback();
        },
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return SizedBox(
            width: width,
            height: height,
            child: const Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildFallback() {
    // Determinar qué mostrar en el centro: Código de producto o Iniciales.
    final displayString = (productName != null && productName!.length > 2)
        ? productName!.substring(0, 2).toUpperCase()
        : productCode.isNotEmpty
            ? productCode
            : '?';

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: borderRadius ?? BorderRadius.circular(8),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkCard.withOpacity(0.8),
            AppTheme.darkBase,
          ],
        ),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Stack(
        children: [
          // Icono grande desvanecido en el fondo
          Positioned(
            right: -10,
            bottom: -10,
            child: Icon(
              Icons.inventory_2_rounded,
              size: (width > height ? height : width) * 0.8,
              color: Colors.white.withOpacity(0.04),
            ),
          ),
          // Texto centrado
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!showCodeOnFallback)
                   Icon(Icons.image_not_supported_rounded, color: Colors.white24, size: 28),
                if (showCodeOnFallback) ...[
                   Text(
                     displayString,
                     style: const TextStyle(
                       color: Colors.white60,
                       fontWeight: FontWeight.w800,
                       fontSize: 16,
                       letterSpacing: 2,
                     ),
                     textAlign: TextAlign.center,
                     maxLines: 1,
                     overflow: TextOverflow.ellipsis,
                   ),
                   if (displayString != productCode && productCode.isNotEmpty)
                     Padding(
                       padding: const EdgeInsets.only(top: 4),
                       child: Text(
                         productCode,
                         style: TextStyle(
                           color: AppTheme.neonBlue.withOpacity(0.6),
                           fontWeight: FontWeight.bold,
                           fontSize: 10,
                         ),
                       ),
                     ),
                ]
              ],
            ),
          ),
        ],
      ),
    );
  }
}
