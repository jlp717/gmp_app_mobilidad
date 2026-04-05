import 'package:flutter/material.dart';

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
    final displayString = (productName != null && productName!.length > 2)
        ? productName!.substring(0, 2).toUpperCase()
        : productCode.isNotEmpty
            ? productCode
            : '?';

    if (!showCodeOnFallback) {
      return SizedBox(width: width, height: height);
    }

    return SizedBox(
      width: width,
      height: height,
      child: ClipRRect(
        borderRadius: borderRadius ?? BorderRadius.circular(8),
        child: Container(
          color: Colors.white.withOpacity(0.05),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.image_not_supported_rounded,
                  color: Colors.white24,
                  size: (width < height ? width : height) * 0.35,
                ),
                const SizedBox(height: 4),
                Text(
                  displayString,
                  style: const TextStyle(
                    color: Colors.white38,
                    fontWeight: FontWeight.w600,
                    fontSize: 10,
                    letterSpacing: 1,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
