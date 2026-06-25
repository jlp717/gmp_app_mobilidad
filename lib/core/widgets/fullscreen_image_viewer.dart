import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';

/// Full-screen, zoomable product image viewer.
class FullscreenImageViewer extends StatelessWidget {
  /// Creates a product image viewer.
  const FullscreenImageViewer({
    required this.imageUrl,
    required this.productName,
    super.key,
    this.headers,
    this.productCode,
  });

  /// Product image URL.
  final String imageUrl;

  /// Product title shown in the app bar.
  final String productName;

  /// Optional HTTP headers for protected image endpoints.
  final Map<String, String>? headers;

  /// Optional product code used by image fallbacks.
  final String? productCode;

  Map<String, String> get _effectiveHeaders {
    if (headers != null) return headers!;
    final auth = ApiClient.authHeaders;
    return {
      'Accept': 'image/*',
      if (auth['Authorization'] != null)
        'Authorization': auth['Authorization']!,
    };
  }

  /// Opens the product image viewer.
  static void show(
    BuildContext context, {
    required String imageUrl,
    required String productName,
    String? productCode,
    Map<String, String>? headers,
    bool rootNavigator = false,
  }) {
    Navigator.of(context, rootNavigator: rootNavigator).push(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: Colors.black54,
        barrierDismissible: true,
        pageBuilder: (ctx, anim, secondAnim) {
          return FullscreenImageViewer(
            imageUrl: imageUrl,
            productName: productName,
            productCode: productCode,
            headers: headers,
          );
        },
        transitionsBuilder: (ctx, anim, secondAnim, child) {
          return FadeTransition(opacity: anim, child: child);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const viewerBackground = Colors.black;
    const imageSurface = Color(0xFFF7F8FA);

    return Scaffold(
      backgroundColor: viewerBackground,
      appBar: AppBar(
        backgroundColor: viewerBackground,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text(
          productName,
          style: const TextStyle(color: Colors.white, fontSize: 14),
          overflow: TextOverflow.ellipsis,
        ),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Container(
            color: imageSurface,
            width: double.infinity,
            height: double.infinity,
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 5,
              child: Center(
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: productCode ?? '',
                  productName: productName,
                  headers: _effectiveHeaders,
                  fit: BoxFit.contain,
                  borderRadius: BorderRadius.zero,
                  forceRetry: true,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
