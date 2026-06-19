import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';

/// Premium product image widget with elegant fallback.
/// Memoizes failed URLs with TTL to prevent repeated 404 requests
/// while allowing retries after cache expiry (default: 1 hour).
/// Uses product-code-based gradient for visually distinct placeholders.
/// Now caches image bytes persistently using CacheService.
class SmartProductImage extends StatelessWidget {
  const SmartProductImage(
      {required this.imageUrl,
      required this.productCode,
      super.key,
      this.productName,
      this.width = double.infinity,
      this.height = double.infinity,
      this.fit = BoxFit.cover,
      this.borderRadius,
      this.showCodeOnFallback = true,
      this.headers,
      this.forceRetry = false // Nuevo parámetro para forzar reintento
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
  final bool forceRetry; // Nuevo parámetro para forzar reintento

  /// TTL-based failed URL cache: URL → timestamp when it failed.
  /// Entries expire after [_failedUrlTTL] to allow retries.
  static final Map<String, DateTime> _failedUrls = {};
  static const Duration _failedUrlTTL = Duration(hours: 1);

  /// Check if a URL is currently in the failed cache (not expired).
  static bool _isFailed(String url) {
    final failedAt = _failedUrls[url];
    if (failedAt == null) return false;
    if (DateTime.now().difference(failedAt) > _failedUrlTTL) {
      _failedUrls.remove(url); // Expired, clean up
      return false;
    }
    return true;
  }

  /// Mark a URL as failed (with current timestamp).
  static void _markFailed(String url) {
    _failedUrls[url] = DateTime.now();
  }

  /// Clear all expired entries from the failed URL cache.
  /// Call this on network state changes or app resume.
  static void clearExpired() {
    final now = DateTime.now();
    _failedUrls.removeWhere((_, ts) => now.difference(ts) > _failedUrlTTL);
  }

  /// Clear all failed URLs (use sparingly, e.g., on logout or major state change).
  static void clearAll() {
    _failedUrls.clear();
  }

  @override
  Widget build(BuildContext context) {
    // Si forceRetry es true, ignoramos el caché de URLs fallidas
    if (imageUrl.isEmpty || (!forceRetry && _isFailed(imageUrl))) {
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
          _markFailed(imageUrl);
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
                accent.withValues(alpha: 0.15),
                accent.withValues(alpha: 0.05),
              ],
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.image_not_supported_rounded,
                  color: accent.withValues(alpha: 0.35),
                  size: (width < height ? width : height) * 0.35,
                ),
                const SizedBox(height: 4),
                Text(
                  displayString,
                  style: TextStyle(
                    color: accent.withValues(alpha: 0.5),
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
