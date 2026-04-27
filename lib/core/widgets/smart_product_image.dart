import 'dart:math';

import 'package:flutter/material.dart';

/// Premium product image widget with elegant fallback.
/// Memoizes failed URLs to prevent repeated 404 requests.
/// Uses product-code-based gradient for visually distinct placeholders.
class SmartProductImage extends StatelessWidget {
  const SmartProductImage({
    required this.imageUrl,
    required this.productCode,
    super.key,
    this.productName,
    this.width = double.infinity,
    this.height = double.infinity,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.showCodeOnFallback = true,
    this.headers,
  });
  final String imageUrl;
  final String productCode;
  final String? productName;
  final double width;
  final double height;
  final BoxFit fit;
  final BorderRadiusGeometry? borderRadius;
  final bool showCodeOnFallback;
  final Map<String, String>? headers;

  static final Set<String> _failedUrls = {};

  @override
  Widget build(BuildContext context) {
    if (imageUrl.isEmpty || _failedUrls.contains(imageUrl)) {
      return _buildFallback();
    }

    final cacheW = width.isFinite ? (width * 2).toInt() : null;
    final cacheH = height.isFinite ? (height * 2).toInt() : null;

    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(8),
      child: Image.network(
        imageUrl,
        headers: headers,
        width: width,
        height: height,
        fit: fit,
        cacheWidth: cacheW,
        cacheHeight: cacheH,
        errorBuilder: (context, error, stackTrace) {
          _failedUrls.add(imageUrl);
          return _buildFallback();
        },
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          final total = loadingProgress.expectedTotalBytes;
          if (total == null || total <= 0) {
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
          }
          return SizedBox(
            width: width,
            height: height,
            child: Center(
              child: CircularProgressIndicator(
                value: loadingProgress.cumulativeBytesLoaded / total,
                strokeWidth: 2,
              ),
            ),
          );
        },
      ),
    );
  }

  static int _hashCode(String code) {
    var hash = 0;
    for (var i = 0; i < code.length; i++) {
      hash = (hash * 31 + code.codeUnitAt(i)) & 0x7FFFFFFF;
    }
    return hash;
  }

  static Color _colorFromHash(int hash) {
    const hues = [
      0xFF00D4FF, // neonBlue
      0xFF00FF88, // neonGreen
      0xFFBB86FC, // neonPurple
      0xFFFF6B9D, // neonPink
      0xFF00CED1, // neonTeal
      0xFFFFC233, // chartYellow
      0xFF8B5CF6, // chartViolet
      0xFF10B981, // chartEmerald
    ];
    return Color(hues[hash.abs() % hues.length]);
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

    final accent = _colorFromHash(_hashCode(productCode));

    return SizedBox(
      width: width,
      height: height,
      child: ClipRRect(
        borderRadius: borderRadius ?? BorderRadius.circular(8),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                accent.withOpacity(0.15),
                accent.withOpacity(0.05),
              ],
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.image_not_supported_rounded,
                  color: accent.withOpacity(0.35),
                  size: (width < height ? width : height) * 0.35,
                ),
                const SizedBox(height: 4),
                Text(
                  displayString,
                  style: TextStyle(
                    color: accent.withOpacity(0.5),
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
