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
    if (_profile.isVerified && _profile.profile == EnvironmentKind.demo) {
      return widget.child;
    }
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

    final topInset = MediaQuery.paddingOf(context).top;

    return Column(
      children: [
        Material(
          color: background,
          child: IgnorePointer(
            child: Semantics(
              container: true,
              liveRegion: true,
              label: semanticLabel,
              child: ExcludeSemantics(
                child: SizedBox(
                  width: double.infinity,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: foreground, width: 1.5),
                      ),
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 960),
                        child: Padding(
                          padding: EdgeInsets.fromLTRB(
                            12,
                            topInset + 8,
                            12,
                            8,
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                unverified
                                    ? Icons.gpp_maybe_outlined
                                    : Icons.science_outlined,
                                size: 24,
                                color: foreground,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  visibleLabel,
                                  softWrap: true,
                                  style: TextStyle(
                                    color: foreground,
                                    fontSize: 18,
                                    height: 1.2,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 0.3,
                                    decoration: TextDecoration.none,
                                  ),
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
            ),
          ),
        ),
        Expanded(
          child: MediaQuery.removeViewPadding(
            context: context,
            removeTop: true,
            child: MediaQuery.removePadding(
              context: context,
              removeTop: true,
              child: widget.child,
            ),
          ),
        ),
      ],
    );
  }
}
