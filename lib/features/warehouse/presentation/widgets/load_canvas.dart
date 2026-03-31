import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/theme/app_theme.dart';
import '../../application/load_planner_provider.dart';
import '../../domain/models/load_planner_models.dart';

/// Interactive 3D canvas powered by Three.js in a WebView.
///
/// Communicates with Flutter via JavaScriptChannel (JS→Dart)
/// and evaluateJavascript (Dart→JS).
class LoadCanvas extends StatefulWidget {
  const LoadCanvas({super.key});

  @override
  LoadCanvasState createState() => LoadCanvasState();
}

class LoadCanvasState extends State<LoadCanvas> {
  late final WebViewController _controller;
  bool _sceneReady = false;

  // Track provider state to detect changes and push to JS
  ViewMode? _lastViewMode;
  ColorMode? _lastColorMode;
  int? _lastSelectedIndex;
  int _lastBoxCount = -1;
  bool _lastCollisionState = false;
  bool _fullStatePushed = false;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  void _initWebView() {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppTheme.darkBase)
      ..setOnConsoleMessage((message) {
        debugPrint('[WebView JS] ${message.level}: ${message.message}');
      })
      ..addJavaScriptChannel(
        'FlutterBridge',
        onMessageReceived: _handleJsMessage,
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) => _onPageLoaded(),
        ),
      )
      ..loadFlutterAsset('assets/load_planner/index.html');

    // Safety timeout: if sceneReady never arrives, force it
    Future.delayed(const Duration(seconds: 12), () {
      if (mounted && !_sceneReady) {
        debugPrint('[LoadCanvas] sceneReady timeout — forcing ready');
        setState(() => _sceneReady = true);
      }
    });
  }

  void _onPageLoaded() {
    // Scene will send 'sceneReady' event when Three.js is initialized.
    // We wait for that before sending data.
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JS → FLUTTER MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════

  void _handleJsMessage(JavaScriptMessage message) {
    if (!mounted) return;

    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      final type = data['type'] as String?;
      final provider = context.read<LoadPlannerProvider>();

      switch (type) {
        case 'sceneReady':
          setState(() => _sceneReady = true);
          _pushFullState(provider);
          break;

        case 'boxSelected':
          final index = data['index'] as int?;
          if (index != null) {
            HapticFeedback.selectionClick();
            provider.selectBox(index);
          }
          break;

        case 'canvasTapped':
          provider.clearSelection();
          break;

        case 'boxDragStart':
          final index = data['index'] as int?;
          if (index != null) {
            HapticFeedback.mediumImpact();
            provider.startDrag(index);
          }
          break;

        case 'boxDragMove':
          final x = (data['x'] as num?)?.toDouble();
          final y = (data['y'] as num?)?.toDouble();
          if (x != null && y != null) {
            provider.updateDragPosition(x, y);
            // Push collision state back to JS
            final hasCollision = provider.dragState?.hasCollision ?? false;
            if (hasCollision != _lastCollisionState) {
              _lastCollisionState = hasCollision;
              final idx = provider.dragState?.boxIndex ?? -1;
              _runJs(
                'ThreeBridge.setCollisionState($idx, $hasCollision)',
              );
            }
          }
          break;

        case 'boxDragEnd':
          final hasCollision = provider.dragState?.hasCollision ?? false;
          if (hasCollision) {
            HapticFeedback.heavyImpact();
          } else {
            HapticFeedback.lightImpact();
          }
          provider.endDrag();
          _lastCollisionState = false;
          // After drag ends, sync positions back (provider may have reverted)
          _pushBoxes(provider);
          break;

        case 'boxesSettled':
          // JS engine settled gravity — update provider positions
          final settledBoxes = data['boxes'] as List?;
          if (settledBoxes != null) {
            provider.applySettledPositions(
              settledBoxes.cast<Map<String, dynamic>>(),
            );
            _lastBoxCount = provider.placedBoxes.length;
          }
          break;

        case 'boxesRepacked':
          // JS engine repacked — update provider
          final placedList = data['placed'] as List?;
          final overflowList = data['overflow'] as List?;
          if (placedList != null) {
            provider.applyRepackResult(
              placedList.cast<Map<String, dynamic>>(),
              overflowList?.cast<Map<String, dynamic>>() ?? [],
            );
            _lastBoxCount = provider.placedBoxes.length;
          }
          break;
      }
    } catch (e) {
      debugPrint('JS message parse error: $e');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLUTTER → JS MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════

  void _runJs(String code) {
    if (!_sceneReady) return;
    _controller.runJavaScript(code);
  }

  /// Toggle wall visibility from outside (toolbar button)
  void toggleWalls(bool visible) {
    _runJs('ThreeBridge.toggleWalls($visible)');
  }

  /// Trigger client-side 3D bin packing in JS
  void repackBoxes() {
    _runJs('ThreeBridge.repack()');
  }

  void _pushFullState(LoadPlannerProvider provider) {
    if (!_sceneReady) return;
    if (provider.truck == null) return;
    _fullStatePushed = true;

    final truckJson = jsonEncode({
      'lengthCm': provider.truck!.lengthCm,
      'widthCm': provider.truck!.widthCm,
      'heightCm': provider.truck!.heightCm,
      'maxPayloadKg': provider.truck!.maxPayloadKg,
    });

    final boxesJson = jsonEncode(
      provider.placedBoxes.map((b) => b.toJson()).toList(),
    );

    _runJs("ThreeBridge.loadScene('${_escapeJs(truckJson)}', "
        "'${_escapeJs(boxesJson)}')");

    // Apply current view/color mode
    _pushViewMode(provider.viewMode);
    _pushColorMode(provider.colorMode);

    if (provider.selectedBoxIndex != null) {
      _runJs('ThreeBridge.selectBox(${provider.selectedBoxIndex})');
    }

    _lastViewMode = provider.viewMode;
    _lastColorMode = provider.colorMode;
    _lastSelectedIndex = provider.selectedBoxIndex;
    _lastBoxCount = provider.placedBoxes.length;
  }

  void _pushBoxes(LoadPlannerProvider provider) {
    final boxesJson = jsonEncode(
      provider.placedBoxes.map((b) => b.toJson()).toList(),
    );
    _runJs("ThreeBridge.updateBoxes('${_escapeJs(boxesJson)}')");
    _lastBoxCount = provider.placedBoxes.length;
  }

  void _pushViewMode(ViewMode mode) {
    final name = mode.name; // 'perspective', 'top', 'front'
    _runJs("ThreeBridge.setViewMode('$name')");
  }

  void _pushColorMode(ColorMode mode) {
    final name = mode.name; // 'product', 'client', 'weight'
    _runJs("ThreeBridge.setColorMode('$name')");
  }

  /// Escape single quotes and newlines for JS string literals
  String _escapeJs(String s) {
    return s
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC PROVIDER CHANGES → JS
  // ═══════════════════════════════════════════════════════════════════════════

  void _syncProviderToJs(LoadPlannerProvider provider) {
    if (!_sceneReady) return;

    // If full state was never pushed (sceneReady arrived before data loaded), push now
    if (!_fullStatePushed && provider.truck != null) {
      _pushFullState(provider);
      return;
    }

    // View mode changed
    if (provider.viewMode != _lastViewMode) {
      _pushViewMode(provider.viewMode);
      _lastViewMode = provider.viewMode;
    }

    // Color mode changed
    if (provider.colorMode != _lastColorMode) {
      _pushColorMode(provider.colorMode);
      _lastColorMode = provider.colorMode;
    }

    // Selection changed
    if (provider.selectedBoxIndex != _lastSelectedIndex) {
      final idx = provider.selectedBoxIndex ?? -1;
      _runJs('ThreeBridge.selectBox($idx)');
      _lastSelectedIndex = provider.selectedBoxIndex;
    }

    // Box count changed (exclude/include/undo/redo)
    if (provider.placedBoxes.length != _lastBoxCount) {
      _pushBoxes(provider);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    return Consumer<LoadPlannerProvider>(
      builder: (context, provider, child) {
        // Push state changes to JS when provider updates
        if (_sceneReady && provider.truck != null) {
          // Use post-frame callback to avoid calling JS during build
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _syncProviderToJs(provider);
          });
        }

        return Stack(
          children: [
            // WebView (Three.js scene)
            WebViewWidget(controller: _controller),

            // Loading overlay while Three.js initializes
            if (!_sceneReady || provider.truck == null)
              Container(
                color: AppTheme.darkBase,
                child: const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(color: AppTheme.neonBlue),
                      SizedBox(height: 16),
                      Text(
                        'Cargando escena 3D...',
                        style: TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
