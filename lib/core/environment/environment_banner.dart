import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/environment/environment_profile.dart';
import 'package:gmp_app_mobilidad/core/environment/environment_profile_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

/// Asynchronous source used to resolve the current server environment.
typedef EnvironmentProfileLoader = Future<EnvironmentProfile> Function();

/// Global safety ribbon for non-production or unverified server profiles.
class EnvironmentBanner extends StatefulWidget {
  /// Creates a ribbon around [child].
  const EnvironmentBanner({
    required this.child,
    this.loader = EnvironmentProfileService.load,
    super.key,
  });

  /// Application content rendered below the non-interactive ribbon.
  final Widget child;

  /// Profile source; injectable for deterministic widget tests.
  final EnvironmentProfileLoader loader;

  /// Creates the state that refreshes the server contract on app resume.
  @override
  State<EnvironmentBanner> createState() => _EnvironmentBannerState();
}

class _EnvironmentBannerState extends State<EnvironmentBanner>
    with WidgetsBindingObserver {
  EnvironmentProfile _profile = EnvironmentProfile.unverified;
  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
  }

  @override
  void didUpdateWidget(covariant EnvironmentBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.loader != widget.loader) unawaited(_refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_refresh());
  }

  @override
  void dispose() {
    _requestGeneration++;
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _refresh() async {
    final generation = ++_requestGeneration;
    EnvironmentProfile next;
    try {
      next = await widget.loader();
    } catch (_) {
      next = EnvironmentProfile.unverified;
    }
    if (!mounted || generation != _requestGeneration) return;
    setState(() => _profile = next);
  }

  @override
  Widget build(BuildContext context) {
    final unverified = !_profile.isVerified;
    final production =
        _profile.isVerified && _profile.profile == EnvironmentKind.production;
    final background =
        unverified || production ? AppColors.brick : AppColors.ochre;
    final foreground =
        unverified || production ? AppColors.onAccent : AppColors.ink;
    final productionWriteLabel =
        _profile.productionWritesEnabled ? 'ESCRITURA ACTIVA' : 'SOLO LECTURA';
    final visibleLabel = production
        ? '${_profile.label} · $productionWriteLabel'
        : _profile.label;
    final semanticLabel = unverified
        ? 'Entorno sin verificar'
        : 'Entorno verificado: $visibleLabel';

    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        Positioned(
          top: MediaQuery.paddingOf(context).top + 8,
          right: 8,
          child: IgnorePointer(
            child: Semantics(
              container: true,
              liveRegion: true,
              label: semanticLabel,
              child: ExcludeSemantics(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: background,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: foreground, width: 1.5),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x52000000),
                        blurRadius: 8,
                        offset: Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 7,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          unverified
                              ? Icons.gpp_maybe_outlined
                              : Icons.science_outlined,
                          size: 20,
                          color: foreground,
                        ),
                        const SizedBox(width: 7),
                        Text(
                          visibleLabel,
                          style: TextStyle(
                            color: foreground,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
