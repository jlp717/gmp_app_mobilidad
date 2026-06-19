import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Premium page route transition — slide + fade with subtle scale.
///
/// Using this globally gives the app a consistent, polished feel
/// across all screen transitions (push/pop).
class PremiumSlideRoute<T> extends PageRouteBuilder<T> {
  PremiumSlideRoute({
    required Widget page,
    RouteSettings? settings,
    Duration duration = const Duration(milliseconds: 300),
  }) : super(
          settings: settings,
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0.15, 0.0),
                end: Offset.zero,
              ).animate(CurvedAnimation(
                parent: animation,
                curve: Curves.easeOutCubic,
                reverseCurve: Curves.easeInCubic,
              )),
              child: FadeTransition(
                opacity: Tween<double>(begin: 0.0, end: 1.0).animate(
                  CurvedAnimation(
                    parent: animation,
                    curve: Curves.easeOut,
                  ),
                ),
                child: ScaleTransition(
                  scale: Tween<double>(begin: 0.98, end: 1.0).animate(
                    CurvedAnimation(
                      parent: animation,
                      curve: Curves.easeOutCubic,
                    ),
                  ),
                  child: child,
                ),
              ),
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

/// Fade transition — subtle, for modals/bottom sheets.
class PremiumFadeRoute<T> extends PageRouteBuilder<T> {
  PremiumFadeRoute({
    required Widget page,
    RouteSettings? settings,
    Duration duration = const Duration(milliseconds: 250),
  }) : super(
          settings: settings,
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return FadeTransition(
              opacity: Tween<double>(begin: 0.0, end: 1.0).animate(
                CurvedAnimation(
                  parent: animation,
                  curve: Curves.easeOut,
                ),
              ),
              child: child,
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

/// Scale transition — zoom-in effect for hero/featured content.
class PremiumScaleRoute<T> extends PageRouteBuilder<T> {
  PremiumScaleRoute({
    required Widget page,
    RouteSettings? settings,
    Duration duration = const Duration(milliseconds: 350),
  }) : super(
          settings: settings,
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return ScaleTransition(
              scale: Tween<double>(begin: 0.92, end: 1.0).animate(
                CurvedAnimation(
                  parent: animation,
                  curve: Curves.easeOutBack,
                ),
              ),
              child: FadeTransition(
                opacity: Tween<double>(begin: 0.0, end: 1.0).animate(
                  CurvedAnimation(
                    parent: animation,
                    curve: Curves.easeOut,
                  ),
                ),
                child: child,
              ),
            );
          },
          transitionDuration: duration,
          reverseTransitionDuration: duration,
        );
}

/// Convenience extension on [Navigator] for premium navigation.
extension PremiumNavigator on BuildContext {
  /// Push a page with the premium slide+fade transition.
  Future<T?> pushPremium<T extends Object?>(Widget page) {
    return Navigator.of(this).push<T>(PremiumSlideRoute<T>(page: page));
  }

  /// Replace current route with premium fade transition.
  Future<T?> pushReplacementPremium<T extends Object?, TO extends Object?>(
      Widget page) {
    return Navigator.of(this).pushReplacement<T, TO>(
      PremiumFadeRoute<T>(page: page),
    );
  }

  /// Push a page with scale+pop effect.
  Future<T?> pushScale<T extends Object?>(Widget page) {
    return Navigator.of(this).push<T>(PremiumScaleRoute<T>(page: page));
  }
}

/// Custom page transition for GoRouter — slide + fade.
CustomTransitionPage buildPremiumTransitionPage({
  required BuildContext context,
  required GoRouterState state,
  required Widget child,
}) {
  return CustomTransitionPage(
    key: state.pageKey,
    child: child,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0.08, 0.0),
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        )),
        child: FadeTransition(
          opacity: Tween<double>(begin: 0.0, end: 1.0).animate(
            CurvedAnimation(
              parent: animation,
              curve: Curves.easeOut,
            ),
          ),
          child: child,
        ),
      );
    },
  );
}
