import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';

class FullscreenImageViewer extends StatelessWidget {
  const FullscreenImageViewer({
    required this.imageUrl,
    required this.productName,
    super.key,
    this.headers,
    this.productCode,
  });

  final String imageUrl;
  final String productName;
  final Map<String, String>? headers;
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

  static void show(
    BuildContext context, {
    required String imageUrl,
    required String productName,
    String? productCode,
    Map<String, String>? headers,
  }) {
    Navigator.of(context).push(
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
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        iconTheme: const IconThemeData(color: Color(0xFF0F172A)),
        title: Text(
          productName,
          style: const TextStyle(color: Color(0xFF0F172A), fontSize: 14),
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
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Container(
              color: Colors.white,
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
                    fit: BoxFit.contain,
                    borderRadius: BorderRadius.zero,
                    headers: _effectiveHeaders,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
